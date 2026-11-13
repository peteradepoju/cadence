import { lastStamp, stampAt, stampDevice } from "./crdt";
import { addDays, today } from "./dates";
import { gjson, gfetch, GoogleError } from "./google";
import { DEFAULT_COLUMNS, PALETTE, type Task } from "./model";
import { completeTask } from "./actions";
import { all, DEVICE, get, getAny, put, putFrom, settings, setSettings, snapshot } from "./store";

// Two-way sync with Google Tasks.
//  • The Inbox syncs with your default Google list ("My Tasks"); each project with a list of the same name.
//  • Lists made in Google Tasks become projects in Cadence.
//  • Title, notes, due date, done and subtasks go both ways. An edit made in Google Tasks counts as made at
//    the time Google says it was, so it wins or loses against Cadence edits field by field, like any device.
//  • Google Tasks has no repeats, times, priorities or tags: those stay in Cadence. When a repeating task is
//    ticked off in Google Tasks, Cadence moves it to its next date and Google shows it again.

const API = "https://tasks.googleapis.com/tasks/v1";
const GOOGLE = "~gtasks"; // device name for edits that came from Google Tasks
const SYNC_FIELDS = ["title", "notes", "due", "done", "deleted", "projectId", "parentId"];

interface GList { id: string; title: string; updated: string }
interface GTask { id: string; title?: string; notes?: string; due?: string; status?: "needsAction" | "completed"; completed?: string; deleted?: boolean; hidden?: boolean; parent?: string; updated: string; position?: string }

const cursorKey = (list: string) => `cadence:gt:cursor:${list}`;
const getCursor = (list: string) => { try { return localStorage.getItem(cursorKey(list)) ?? ""; } catch { return ""; } };
const setCursor = (list: string, v: string) => { try { localStorage.setItem(cursorKey(list), v); } catch {} };
export function resetGTasksCursors() { try { Object.keys(localStorage).filter(k => k.startsWith("cadence:gt:cursor:")).forEach(k => localStorage.removeItem(k)); } catch {} }

async function lists(): Promise<GList[]> {
  const out: GList[] = [];
  let page = "";
  do {
    const r = await gjson<{ items?: GList[]; nextPageToken?: string }>(`${API}/users/@me/lists?maxResults=100${page ? "&pageToken=" + page : ""}`);
    out.push(...(r.items ?? []));
    page = r.nextPageToken ?? "";
  } while (page);
  return out;
}

async function listTasks(list: string, updatedMin: string): Promise<GTask[]> {
  const out: GTask[] = [];
  let page = "";
  do {
    const u = new URL(`${API}/lists/${list}/tasks`);
    u.searchParams.set("maxResults", "100");
    u.searchParams.set("showCompleted", "true");
    u.searchParams.set("showHidden", "true");
    u.searchParams.set("showDeleted", updatedMin ? "true" : "false");
    if (updatedMin) u.searchParams.set("updatedMin", updatedMin);
    if (page) u.searchParams.set("pageToken", page);
    const r = await gjson<{ items?: GTask[]; nextPageToken?: string }>(u.toString());
    out.push(...(r.items ?? []));
    page = r.nextPageToken ?? "";
  } while (page);
  return out;
}

const gDue = (d: string | null) => (d ? `${d}T00:00:00.000Z` : null);
const fromGDue = (d?: string) => (d ? d.slice(0, 10) : null);
const localId = (gId: string) => `g_${gId}`;

/** The Google list a task belongs in, or null when its project isn't synced. */
function listFor(t: Pick<Task, "projectId">): string | null {
  if (!t.projectId) return settings().gInbox;
  const p = get("projects", t.projectId);
  return p && !p.archived ? p.gList : null;
}
function projectForList(list: string): string | null | undefined {
  if (list === settings().gInbox) return null;
  return all("projects").find(p => p.gList === list)?.id;
}

/** Links lists and projects: makes a Google list for each project that has none, and a project for each new Google list. */
async function linkLists() {
  const s = settings();
  const gl = await lists();
  if (!gl.length) return;
  if (!s.gInbox || !gl.some(l => l.id === s.gInbox)) setSettings({ gInbox: gl[0].id });
  const inbox = settings().gInbox;
  const byTitle = new Map(gl.map(l => [l.title.trim().toLowerCase(), l]));
  const linked = new Set(all("projects").map(p => p.gList).filter(Boolean));
  for (const p of all("projects")) {
    if (p.archived) continue;
    if (p.gList && gl.some(l => l.id === p.gList)) continue;
    // Its list was deleted in Google, or it has none yet: reuse a list with the same name, or make one.
    const same = byTitle.get(p.name.trim().toLowerCase());
    if (same && same.id !== inbox && !linked.has(same.id)) { put("projects", p.id, { gList: same.id }); linked.add(same.id); continue; }
    const made = await gjson<GList>(`${API}/users/@me/lists`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: p.name.slice(0, 100) }) });
    put("projects", p.id, { gList: made.id }); linked.add(made.id);
  }
  const ignore = new Set(settings().gIgnore);
  for (const l of gl) {
    if (l.id === inbox || linked.has(l.id) || ignore.has(l.id)) continue;
    const id = `gl_${l.id}`;
    if (getAny("projects", id)?.deleted) continue;
    put("projects", id, {
      name: l.title, color: PALETTE[all("projects").length % PALETTE.length], emoji: "", order: all("projects").length, view: "list",
      columns: DEFAULT_COLUMNS.map(c => ({ ...c })), archived: false, favorite: false, notes: "", gList: l.id, createdAt: new Date().toISOString(),
    });
  }
}

async function pull(list: string) {
  const cursor = getCursor(list);
  // Ask from a little before the last change seen, so nothing slips through between two clocks.
  const since = cursor ? new Date(Date.parse(cursor) - 120_000).toISOString() : "";
  const items = await listTasks(list, since);
  const projectId = projectForList(list);
  if (projectId === undefined) return;
  let newest = cursor;
  // Parents first, so subtasks find them.
  items.sort((a, b) => Number(!!a.parent) - Number(!!b.parent));
  const byG = new Map(all("tasks").filter(t => t.gId).map(t => [t.gId!, t]));
  for (const g of items) {
    if (g.updated > newest) newest = g.updated;
    const mine = byG.get(g.id) ?? getAny("tasks", localId(g.id));
    if (mine && mine.gSeen === g.updated) continue; // nothing new (often our own write coming back)
    const stamp = stampAt(Date.parse(g.updated), GOOGLE);
    const parentId = g.parent ? (byG.get(g.parent)?.id ?? localId(g.parent)) : null;
    if (!mine) {
      if (g.deleted) continue;
      // First sync: leave out things finished long ago.
      if (g.status === "completed" && g.completed && g.completed < addDays(today(), -30)) continue;
      const id = localId(g.id);
      putFrom("tasks", id, {
        title: g.title || "(untitled)", notes: g.notes ?? "", projectId, column: null, parentId, order: Date.parse(g.updated), priority: 4, tags: [],
        due: fromGDue(g.due), time: null, duration: null, plannedFor: null, recurrence: null, doneCount: 0, reminders: [], attachments: [],
        goalId: null, energy: null, done: g.status === "completed", doneAt: g.completed ?? null, createdAt: g.updated, origin: GOOGLE,
        source: "gtasks", link: null, gId: g.id, gList: list, gSeen: g.updated, gPushed: stamp, calPushed: null, deleted: false,
      }, stamp);
      continue;
    }
    if (g.deleted) { putFrom("tasks", mine.id, { deleted: true, gSeen: g.updated, gPushed: stamp }, stamp); continue; }
    const doneInGoogle = g.status === "completed";
    if (doneInGoogle && !mine.done && mine.recurrence && mine.due) {
      // Ticked off in Google Tasks: Cadence moves a repeating task on (and that goes back to Google).
      completeTask(mine.id);
      put("tasks", mine.id, { gSeen: g.updated });
      continue;
    }
    putFrom("tasks", mine.id, {
      title: g.title || mine.title, notes: g.notes ?? "", due: mine.recurrence && !g.due ? mine.due : fromGDue(g.due),
      done: doneInGoogle, doneAt: doneInGoogle ? (g.completed ?? mine.doneAt) : null,
      parentId: g.parent ? parentId : (mine.parentId && get("tasks", mine.parentId)?.gId ? null : mine.parentId),
      ...(projectId !== mine.projectId && mine.gList !== list ? { projectId } : {}),
      gList: list, gPushed: stamp,
    }, stamp);
    put("tasks", mine.id, { gSeen: g.updated, gId: g.id });
  }
  if (newest && newest !== cursor) setCursor(list, newest);
}

function body(t: Task) {
  return {
    title: t.title.slice(0, 1024),
    notes: (t.notes ?? "").slice(0, 8000),
    due: gDue(t.due),
    status: t.done ? "completed" : "needsAction",
    ...(t.done ? {} : { completed: null }),
  };
}

async function push() {
  const snap = snapshot().tasks ?? {};
  const want = Object.values(snap)
    .map(r => ({ r, t: getAny("tasks", r.id)! }))
    .filter(({ r, t }) => {
      if (!t) return false;
      const s = lastStamp(r, SYNC_FIELDS);
      return s > (t.gPushed ?? "") && stampDevice(s) !== GOOGLE;
    })
    // parents before subtasks
    .sort((a, b) => Number(!!a.t.parentId) - Number(!!b.t.parentId));
  for (const { r, t } of want) {
    const stamp = lastStamp(r, SYNC_FIELDS);
    const list = listFor(t);
    try {
      if (t.deleted || !list) {
        if (t.gId && t.gList) {
          const res = await gfetch(`${API}/lists/${t.gList}/tasks/${t.gId}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw new GoogleError(res.status, "");
          put("tasks", t.id, { gId: null, gList: null, gSeen: null });
        }
        put("tasks", t.id, { gPushed: stamp });
        continue;
      }
      const parent = t.parentId ? get("tasks", t.parentId) : undefined;
      const parentG = parent && parent.gList === list ? parent.gId : null;
      if (t.parentId && parent && !parentG) continue; // the parent goes first; try again next time
      if (!t.gId) {
        // Only the device that made a task creates it in Google, so two devices never both add it.
        // (A task left waiting for 10 minutes can be added by any device.)
        if (t.origin !== DEVICE && Date.now() - Date.parse(t.createdAt) < 600_000) continue;
        if (t.done && t.doneAt && t.doneAt < addDays(today(), -30)) { put("tasks", t.id, { gPushed: stamp }); continue; }
        const made = await gjson<GTask>(`${API}/lists/${list}/tasks${parentG ? "?parent=" + parentG : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(t)) });
        put("tasks", t.id, { gId: made.id, gList: list, gSeen: made.updated, gPushed: stamp });
        continue;
      }
      let gid = t.gId, glist = t.gList ?? list;
      if (glist !== list) {
        // Moved to another project: move it to that list.
        const moved = await gfetch(`${API}/lists/${glist}/tasks/${gid}/move?destinationTasklist=${list}${parentG ? "&parent=" + parentG : ""}`, { method: "POST" });
        if (moved.ok) { const m = (await moved.json()) as GTask; gid = m.id; glist = list; }
        else {
          await gfetch(`${API}/lists/${glist}/tasks/${gid}`, { method: "DELETE" });
          const made = await gjson<GTask>(`${API}/lists/${list}/tasks${parentG ? "?parent=" + parentG : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(t)) });
          put("tasks", t.id, { gId: made.id, gList: list, gSeen: made.updated, gPushed: stamp });
          continue;
        }
      }
      const res = await gfetch(`${API}/lists/${glist}/tasks/${gid}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body(t)) });
      if (res.status === 404) { put("tasks", t.id, { gId: null, gList: null, gSeen: null }); continue; } // gone in Google: made again next time
      if (!res.ok) throw new GoogleError(res.status, await res.text());
      let g = (await res.json()) as GTask;
      if ((g.parent ?? null) !== (parentG ?? null)) {
        const mv = await gfetch(`${API}/lists/${glist}/tasks/${gid}/move${parentG ? "?parent=" + parentG : ""}`, { method: "POST" });
        if (mv.ok) g = (await mv.json()) as GTask;
      }
      put("tasks", t.id, { gId: gid, gList: glist, gSeen: g.updated, gPushed: stamp });
    } catch (e) {
      if (e instanceof GoogleError && e.status === 400) { put("tasks", t.id, { gPushed: stamp }); continue; } // Google refused this one; don't retry forever
      throw e;
    }
  }
}

export async function syncGoogleTasks(): Promise<void> {
  await linkLists();
  const linked = [settings().gInbox, ...all("projects").filter(p => p.gList && !p.archived).map(p => p.gList!)].filter(Boolean) as string[];
  for (const l of linked) await pull(l);
  await push();
}
