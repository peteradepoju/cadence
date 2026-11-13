import { lastStamp, stampAt, stampMs } from "./crdt";
import { addDays, dueMoment, fromMin, pad, toMin, today, ymd } from "./dates";
import { gjson, gfetch, GoogleError, hasScope } from "./google";
import type { Block, Habit, Task } from "./model";
import { toRRule } from "./recurrence";
import { all, getAny, put, putFrom, settings, setSettings, snapshot } from "./store";

// Google Calendar: how Cadence reminds you when it's closed.
// Cadence keeps its own "Cadence" calendar (it can't touch your other calendars). Timed tasks, tasks
// with reminders, time blocks and habit reminders become events with pop-up alerts, so your phone's
// Google Calendar app notifies you. Event ids come from Cadence's own ids, so every device writes the
// same event and nothing is duplicated. Moving or deleting an event in Google Calendar comes back too.

const API = "https://www.googleapis.com/calendar/v3";
const GCAL = "~gcal";
const TASK_FIELDS = ["title", "notes", "due", "time", "duration", "reminders", "done", "deleted", "calOff", "recurrence"];
const BLOCK_FIELDS = ["date", "start", "end", "title", "deleted"];
const HABIT_FIELDS = ["name", "emoji", "reminder", "kind", "days", "archived", "deleted"];

export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const hex = (s: string) => Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new TextDecoder().decode(new Uint8Array((h.match(/../g) ?? []).map(x => parseInt(x, 16))));
export const eventId = (kind: "t" | "b" | "h" | "r", id: string) => `${kind}${hex(id)}`;

const appUrl = () => (typeof location === "undefined" ? "" : location.origin) + import.meta.env.BASE_URL;
const local = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

interface GEvent {
  id: string; status?: string; summary?: string; description?: string; updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  recurrence?: string[]; colorId?: string; source?: { title: string; url: string }; transparency?: string;
}

export async function ensureCalendar(): Promise<string> {
  const s = settings();
  if (s.calId) {
    const r = await gfetch(`${API}/calendars/${encodeURIComponent(s.calId)}`);
    if (r.ok) return s.calId;
    if (r.status !== 404 && r.status !== 403) throw new GoogleError(r.status, await r.text());
  }
  const made = await gjson<{ id: string }>(`${API}/calendars`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: "Cadence", description: "Tasks, time blocks and habit reminders from Cadence.", timeZone: tz() }),
  });
  setSettings({ calId: made.id });
  return made.id;
}

/** What a task's events should look like now: the main event, plus extra reminder-only events. */
export function taskEvents(t: Task): GEvent[] {
  if (t.deleted || t.done || !t.due || t.calOff) return [];
  const timed = !!t.time || t.reminders.length > 0;
  const description = [t.notes?.trim(), `Open in Cadence: ${appUrl()}task/${t.id}`].filter(Boolean).join("\n\n");
  if (!timed) {
    return [{ id: eventId("t", t.id), summary: t.title, description, start: { date: t.due }, end: { date: addDays(t.due, 1) }, transparency: "transparent", reminders: { useDefault: false, overrides: [] } }];
  }
  const start = dueMoment(t.due, t.time);
  const end = new Date(start.getTime() + (t.duration ?? 30) * 60_000);
  const overrides: { method: string; minutes: number }[] = [];
  const extra: GEvent[] = [];
  for (const r of t.reminders) {
    const at = r.at ? new Date(r.at) : new Date(start.getTime() - (r.before ?? 0) * 60_000);
    const before = Math.round((start.getTime() - at.getTime()) / 60_000);
    if (before >= 0 && before <= 40320 && overrides.length < 5) overrides.push({ method: "popup", minutes: before });
    else if (at.getTime() > Date.now() - 86400_000) {
      extra.push({
        id: eventId("r", `${t.id}:${r.id}`), summary: `⏰ ${t.title}`, description,
        start: { dateTime: local(at), timeZone: tz() }, end: { dateTime: local(new Date(at.getTime() + 5 * 60_000)), timeZone: tz() },
        transparency: "transparent", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
      });
    }
  }
  return [{
    id: eventId("t", t.id), summary: t.title, description,
    start: { dateTime: local(start), timeZone: tz() }, end: { dateTime: local(end), timeZone: tz() },
    reminders: { useDefault: false, overrides }, transparency: t.time ? "opaque" : "transparent",
  }, ...extra];
}

export function blockEvent(b: Block): GEvent | null {
  if (b.deleted) return null;
  return {
    id: eventId("b", b.id), summary: b.title || "Focus", description: `Time block from Cadence: ${appUrl()}calendar`,
    start: { dateTime: `${b.date}T${b.start}:00`, timeZone: tz() }, end: { dateTime: `${b.end <= b.start ? addDays(b.date, 1) : b.date}T${b.end}:00`, timeZone: tz() },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
  };
}

export function habitEvent(h: Habit): GEvent | null {
  if (h.deleted || h.archived || !h.reminder || !settings().habitCalendar) return null;
  const start = today();
  const end = fromMin(toMin(h.reminder) + 10);
  const rule = h.kind === "days" && h.days.length ? toRRule({ freq: "weekly", interval: 1, days: h.days }) : "RRULE:FREQ=DAILY";
  return {
    id: eventId("h", h.id), summary: `${h.emoji ? h.emoji + " " : ""}${h.name}`, description: `Habit from Cadence: ${appUrl()}habits`,
    start: { dateTime: `${start}T${h.reminder}:00`, timeZone: tz() }, end: { dateTime: `${start}T${end}:00`, timeZone: tz() },
    recurrence: [rule], transparency: "transparent", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  };
}

async function upsert(cal: string, ev: GEvent) {
  const url = `${API}/calendars/${encodeURIComponent(cal)}/events`;
  const body = JSON.stringify({ ...ev, status: "confirmed" });
  const r = await gfetch(`${url}/${ev.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body });
  if (r.ok) return;
  if (r.status !== 404) throw new GoogleError(r.status, await r.text());
  const ins = await gfetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!ins.ok && ins.status !== 409) throw new GoogleError(ins.status, await ins.text());
}
async function drop(cal: string, id: string) {
  const r = await gfetch(`${API}/calendars/${encodeURIComponent(cal)}/events/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new GoogleError(r.status, await r.text());
}

async function push(cal: string) {
  const snap = snapshot();
  const horizonPast = addDays(today(), -2), horizonFuture = addDays(today(), 400);
  for (const r of Object.values(snap.tasks ?? {})) {
    const t = getAny("tasks", r.id);
    if (!t) continue;
    const s = lastStamp(r, TASK_FIELDS);
    if (s <= (t.calPushed ?? "")) continue;
    const inRange = t.due && t.due >= horizonPast && t.due <= horizonFuture;
    const evs = inRange ? taskEvents(t) : [];
    const want = new Set(evs.map(e => e.id));
    for (const e of evs) await upsert(cal, e);
    // Remove events that shouldn't exist any more (done, deleted, reminder removed).
    if (t.calPushed || t.done || t.deleted) {
      if (!want.has(eventId("t", t.id))) await drop(cal, eventId("t", t.id));
      for (const old of (t.reminders ?? [])) { const id = eventId("r", `${t.id}:${old.id}`); if (!want.has(id) && t.calPushed) await drop(cal, id).catch(() => {}); }
    }
    put("tasks", t.id, { calPushed: s });
  }
  for (const r of Object.values(snap.blocks ?? {})) {
    const b = getAny("blocks", r.id);
    if (!b) continue;
    const s = lastStamp(r, BLOCK_FIELDS);
    if (s <= (b.calPushed ?? "")) continue;
    const ev = b.date >= horizonPast ? blockEvent(b) : null;
    if (ev) await upsert(cal, ev); else if (b.calPushed) await drop(cal, eventId("b", b.id));
    put("blocks", b.id, { calPushed: s });
  }
  for (const r of Object.values(snap.habits ?? {})) {
    const h = getAny("habits", r.id);
    if (!h) continue;
    const s = lastStamp(r, HABIT_FIELDS) + (settings().habitCalendar ? "1" : "0");
    if (s === (h.calPushed ?? "")) continue;
    const ev = habitEvent(h);
    if (ev) await upsert(cal, ev); else if (h.calPushed) await drop(cal, eventId("h", h.id));
    put("habits", h.id, { calPushed: s });
  }
}

const cursorKey = "cadence:gcal:cursor";
/** Changes made in Google Calendar: a moved event moves its task or block; a deleted one comes off. */
async function pull(cal: string) {
  let cursor = "";
  try { cursor = localStorage.getItem(cursorKey) ?? ""; } catch {}
  const since = cursor ? new Date(Date.parse(cursor) - 120_000).toISOString() : new Date(Date.now() - 7 * 86400_000).toISOString();
  let page = "", newest = cursor;
  do {
    const u = new URL(`${API}/calendars/${encodeURIComponent(cal)}/events`);
    u.searchParams.set("updatedMin", since);
    u.searchParams.set("showDeleted", "true");
    u.searchParams.set("maxResults", "250");
    if (page) u.searchParams.set("pageToken", page);
    const r = await gjson<{ items?: GEvent[]; nextPageToken?: string }>(u.toString());
    for (const ev of r.items ?? []) {
      if (ev.updated && ev.updated > newest) newest = ev.updated;
      applyEvent(ev);
    }
    page = r.nextPageToken ?? "";
  } while (page);
  if (newest && newest !== cursor) try { localStorage.setItem(cursorKey, newest); } catch {}
}

function startOf(ev: GEvent): { date: string; time: string | null; minutes: number | null } | null {
  if (ev.start?.date) return { date: ev.start.date, time: null, minutes: null };
  if (!ev.start?.dateTime) return null;
  const s = new Date(ev.start.dateTime), e = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
  return { date: ymd(s), time: `${pad(s.getHours())}:${pad(s.getMinutes())}`, minutes: e ? Math.round((e.getTime() - s.getTime()) / 60_000) : null };
}

function applyEvent(ev: GEvent) {
  const kind = ev.id[0], id = (() => { try { return unhex(ev.id.slice(1)); } catch { return ""; } })();
  if (!id || !ev.updated) return;
  const at = Date.parse(ev.updated);
  const stamp = stampAt(at, GCAL);
  const cancelled = ev.status === "cancelled";
  if (kind === "t") {
    const t = getAny("tasks", id);
    const rec = snapshot().tasks?.[id];
    if (!t || !rec || t.deleted || t.done || t.calOff) return;
    if (at <= stampMs(lastStamp(rec, TASK_FIELDS)) + 1500) return; // our own write
    if (cancelled) { putFrom("tasks", id, { calOff: true }, stamp); return; }
    const s = startOf(ev);
    if (!s) return;
    const patch: Partial<Task> = {};
    if (s.date !== t.due) patch.due = s.date;
    if (t.time && s.time && s.time !== t.time) patch.time = s.time;
    if (!t.time && s.time && !t.reminders.length) patch.time = s.time;
    if (t.time && s.minutes && s.minutes !== (t.duration ?? 30)) patch.duration = s.minutes;
    if (ev.summary && ev.summary !== t.title) patch.title = ev.summary;
    if (Object.keys(patch).length) putFrom("tasks", id, patch, stamp);
  } else if (kind === "b") {
    const b = getAny("blocks", id);
    const rec = snapshot().blocks?.[id];
    if (!b || !rec || b.deleted) return;
    if (at <= stampMs(lastStamp(rec, BLOCK_FIELDS)) + 1500) return;
    if (cancelled) { putFrom("blocks", id, { deleted: true }, stamp); return; }
    const s = startOf(ev);
    if (!s?.time) return;
    const end = fromMin(toMin(s.time) + (s.minutes ?? 30));
    const patch: Partial<Block> = {};
    if (s.date !== b.date) patch.date = s.date;
    if (s.time !== b.start) patch.start = s.time;
    if (end !== b.end) patch.end = end;
    if (ev.summary && ev.summary !== b.title) patch.title = ev.summary;
    if (Object.keys(patch).length) putFrom("blocks", id, patch, stamp);
  }
}

export async function syncCalendar() {
  if (!hasScope("calendar")) return;
  const cal = await ensureCalendar();
  await pull(cal);
  await push(cal);
}

/** After turning Calendar off or on, everything is sent again next time. */
export function resetCalendarMarks() {
  for (const t of all("tasks")) if (t.calPushed) put("tasks", t.id, { calPushed: null });
  for (const b of all("blocks")) if (b.calPushed) put("blocks", b.id, { calPushed: null });
  for (const h of all("habits")) if (h.calPushed) put("habits", h.id, { calPushed: null });
  try { localStorage.removeItem(cursorKey); } catch {}
}

// ── Your other calendars, to see around your tasks (read-only) ─────────────
export interface OtherEvent { id: string; title: string; date: string; start: string | null; end: string | null; color: string; calendar: string }
export async function otherEvents(from: string, to: string): Promise<OtherEvent[]> {
  if (!hasScope("calendarRead")) return [];
  const cals = await gjson<{ items?: { id: string; summary: string; backgroundColor?: string; selected?: boolean; hidden?: boolean }[] }>(`${API}/users/me/calendarList?minAccessRole=reader`);
  const mine = settings().calId;
  const out: OtherEvent[] = [];
  for (const c of (cals.items ?? []).filter(c => c.id !== mine && c.selected !== false && !c.hidden)) {
    const u = new URL(`${API}/calendars/${encodeURIComponent(c.id)}/events`);
    u.searchParams.set("timeMin", new Date(from + "T00:00:00").toISOString());
    u.searchParams.set("timeMax", new Date(addDays(to, 1) + "T00:00:00").toISOString());
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("orderBy", "startTime");
    u.searchParams.set("maxResults", "250");
    try {
      const r = await gjson<{ items?: GEvent[] }>(u.toString());
      for (const ev of r.items ?? []) {
        if (ev.status === "cancelled") continue;
        const s = startOf(ev);
        if (!s) continue;
        const e = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
        out.push({ id: `${c.id}:${ev.id}`, title: ev.summary ?? "(busy)", date: s.date, start: s.time, end: e ? `${pad(e.getHours())}:${pad(e.getMinutes())}` : null, color: c.backgroundColor ?? "#888", calendar: c.summary });
      }
    } catch { /* one calendar failing shouldn't hide the rest */ }
  }
  return out;
}
