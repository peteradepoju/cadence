import { addDays, dueMoment, pad, today } from "./dates";
import { DEFAULT_COLUMNS, newTask, PALETTE, type Column, type Priority, type Project, type Rule, type Task, uid } from "./model";
import { parseCapture } from "./parse";
import { toRRule } from "./recurrence";
import { all, DEVICE, get, put, snapshot } from "./store";
import { ensureTag } from "./actions";

// Getting data in and out: a full backup, a calendar file, and imports from Selah and Todoist.

export function backupJson(): Blob {
  return new Blob([JSON.stringify({ app: "cadence", kind: "backup", v: 1, at: new Date().toISOString(), data: snapshot() }, null, 1)], { type: "application/json" });
}

/** Plain, readable copy of everything (for people, spreadsheets and other apps). */
export function plainJson(): Blob {
  const out: Record<string, unknown[]> = {};
  for (const c of ["projects", "tasks", "tags", "goals", "blocks", "sessions", "reviews"] as const) out[c] = all(c);
  return new Blob([JSON.stringify({ app: "cadence", exportedAt: new Date().toISOString(), ...out }, null, 2)], { type: "application/json" });
}

export function tasksCsv(): Blob {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [["Title", "Project", "Due", "Time", "Priority", "Tags", "Done", "Done at", "Notes"]];
  for (const t of all("tasks")) rows.push([t.title, t.projectId ? get("projects", t.projectId)?.name ?? "" : "Unsorted", t.due ?? "", t.time ?? "", String(t.priority), t.tags.join(" "), t.done ? "yes" : "", t.doneAt ?? "", t.notes]);
  return new Blob([rows.map(r => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
}

/** An .ics calendar file of open dated tasks, for calendars other than Google's. */
export function icsFile(): Blob {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cadence//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Cadence"];
  for (const t of all("tasks").filter(t => !t.done && t.due)) {
    lines.push("BEGIN:VEVENT", `UID:${t.id}@cadence`, `DTSTAMP:${stamp(new Date())}`, `SUMMARY:${esc(t.title)}`);
    if (t.time) {
      const s = dueMoment(t.due!, t.time), e = new Date(s.getTime() + (t.duration ?? 30) * 60000);
      lines.push(`DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`);
    } else lines.push(`DTSTART;VALUE=DATE:${t.due!.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(t.due!, 1).replace(/-/g, "")}`);
    if (t.recurrence) lines.push(toRRule(t.recurrence));
    if (t.notes) lines.push(`DESCRIPTION:${esc(t.notes)}`);
    for (const r of t.reminders) if (r.before != null) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(t.title)}`, `TRIGGER:-PT${r.before}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Blob([lines.join("\r\n")], { type: "text/calendar" });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ── Selah ──────────────────────────────────────────────────────────────────
// Selah → Settings → Export → "Projects for Cadence" makes this file.
export interface SelahExport {
  app: "selah"; kind: "cadence-export"; v: number;
  projects: { id: string; key: string; name: string; description?: string | null; color?: string; archived?: boolean; statuses: { id: string; name: string; category: "todo" | "in_progress" | "done"; position: number }[] }[];
  tasks: {
    id: string; projectId: string; number: number; title: string; description?: string; statusId: string; priority: string;
    dueDate?: string | null; startDate?: string | null; estimateMinutes?: number | null; storyPoints?: number | null;
    recurrence?: { freq: Rule["freq"]; interval?: number; byWeekday?: number[]; until?: string } | null;
    completedAt?: string | null; createdAt: string; rank?: number;
    savedItem?: { url?: string; title?: string } | null;
    comments?: { body: string; createdAt: string; author?: string | null }[];
    worklogs?: { startedAt: string; endedAt?: string | null; minutes?: number | null; note?: string | null }[];
    reminders?: { remindAt: string; dueOffsetDays?: number | null; dueTime?: string | null; note?: string | null; status: string }[];
  }[];
}

const SELAH_PRIORITY: Record<string, Priority> = { urgent: 1, high: 2, medium: 3, low: 4, none: 4 };

/** Brings Selah's projects in. Importing the same file twice doesn't make copies. */
export function importSelah(x: SelahExport): { projects: number; tasks: number } {
  if (x?.app !== "selah" || !Array.isArray(x.projects)) throw new Error("This isn't a Selah export file.");
  let np = 0, nt = 0;
  const colMap = new Map<string, string>();
  for (const p of x.projects) {
    const pid = `s_${p.id}`;
    const columns: Column[] = [...p.statuses].sort((a, b) => a.position - b.position).map(s => {
      const id = `s_${s.id}`;
      colMap.set(s.id, id);
      return { id, name: s.name, kind: s.category === "in_progress" ? "doing" : s.category };
    });
    if (!get("projects", pid)) np++;
    put("projects", pid, {
      name: p.name, color: p.color || PALETTE[np % PALETTE.length], emoji: "", order: all("projects").length, view: columns.length > 3 ? "board" : "list",
      columns: columns.length ? columns : DEFAULT_COLUMNS.map(c => ({ ...c })), archived: !!p.archived, favorite: false,
      notes: [p.description ?? "", `Imported from Selah (${p.key}).`].filter(Boolean).join("\n\n"), gList: null, createdAt: new Date().toISOString(), deleted: false,
    } satisfies Omit<Project, "id">);
  }
  for (const t of x.tasks) {
    const id = `s_${t.id}`;
    const project = x.projects.find(p => p.id === t.projectId);
    const notes = [
      t.description?.trim(),
      t.savedItem?.url ? `Saved item: ${t.savedItem.title ?? ""} ${t.savedItem.url}`.trim() : "",
      ...(t.comments ?? []).map(c => `— ${c.author ? c.author + ", " : ""}${c.createdAt.slice(0, 10)}: ${c.body}`),
      project ? `(${project.key}-${t.number} in Selah)` : "",
    ].filter(Boolean).join("\n\n");
    const rule: Rule | null = t.recurrence?.freq ? { freq: t.recurrence.freq, interval: t.recurrence.interval ?? 1, ...(t.recurrence.byWeekday?.length ? { days: t.recurrence.byWeekday } : {}), ...(t.recurrence.until ? { until: t.recurrence.until } : {}) } : null;
    // Selah's "N days before at HH:MM" becomes minutes before 09:00 on the due day; anything else an exact time.
    const reminders = (t.reminders ?? []).filter(r => r.status === "pending").map(r => {
      const before = r.dueOffsetDays != null && t.dueDate ? r.dueOffsetDays * 1440 + (540 - toMinutes(r.dueTime ?? "09:00")) : -1;
      return before >= 0 ? { id: uid(), before } : { id: uid(), at: r.remindAt };
    });
    if (!get("tasks", id)) nt++;
    const task = newTask({
      id, title: t.title, notes, projectId: `s_${t.projectId}`, column: colMap.get(t.statusId) ?? null, order: t.rank ?? Date.parse(t.createdAt),
      priority: SELAH_PRIORITY[t.priority] ?? 4, due: t.dueDate ?? null, duration: t.estimateMinutes ?? null, recurrence: t.dueDate ? rule : null,
      reminders, done: !!t.completedAt, doneAt: t.completedAt ?? null, createdAt: t.createdAt, source: "selah", link: t.savedItem?.url ?? null,
      plannedFor: t.startDate && !t.dueDate ? t.startDate : null,
    }, DEVICE);
    const { id: _id, ...fields } = task; void _id;
    put("tasks", id, fields);
    for (const w of t.worklogs ?? []) {
      const minutes = w.minutes ?? (w.endedAt ? Math.round((Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60000) : 0);
      if (minutes > 0) put("sessions", `s_${t.id}_${Date.parse(w.startedAt)}`, { taskId: id, start: w.startedAt, minutes, kind: "manual", note: w.note ?? "From Selah" });
    }
  }
  return { projects: np, tasks: nt };
}
const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

// ── Todoist (Project → ⋯ → Export as a template → CSV) ─────────────────────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

export function importTodoist(text: string, projectName: string): number {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const head = rows.shift()?.map(h => h.trim().toUpperCase()) ?? [];
  const col = (r: string[], name: string) => r[head.indexOf(name)] ?? "";
  if (!head.includes("CONTENT")) throw new Error("This doesn't look like a Todoist CSV export.");
  const project = all("projects").find(p => p.name.toLowerCase() === projectName.toLowerCase());
  const pid = project?.id ?? uid();
  if (!project) put("projects", pid, { name: projectName, color: PALETTE[all("projects").length % PALETTE.length], emoji: "", order: all("projects").length, view: "list", columns: DEFAULT_COLUMNS.map(c => ({ ...c })), archived: false, favorite: false, notes: "Imported from Todoist.", gList: null, createdAt: new Date().toISOString() });
  const parents: string[] = [];
  let section: string | null = null, n = 0;
  const columns = [...(get("projects", pid)?.columns ?? DEFAULT_COLUMNS)];
  for (const r of rows) {
    const type = col(r, "TYPE").toLowerCase();
    if (type === "section") {
      section = col(r, "CONTENT").trim();
      if (section && !columns.some(c => c.name === section)) columns.splice(columns.length - 1, 0, { id: uid(), name: section, kind: "todo" });
      continue;
    }
    if (type !== "task") continue;
    let content = col(r, "CONTENT");
    const labels = [...content.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map(m => m[1].toLowerCase());
    content = content.replace(/@[\p{L}\p{N}_-]+/gu, "").trim();
    const indent = Math.max(1, Number(col(r, "INDENT")) || 1);
    const date = col(r, "DATE").trim();
    const parsed = date ? parseCapture("x " + date) : null;
    const tp = Number(col(r, "PRIORITY")) || 1; // Todoist's CSV: 4 is the most urgent
    const id = uid();
    labels.forEach(ensureTag);
    const task: Task = newTask({
      id, title: content || "(untitled)", notes: col(r, "DESCRIPTION"), projectId: pid, parentId: indent > 1 ? parents[indent - 2] ?? null : null,
      column: section ? columns.find(c => c.name === section)?.id ?? null : "todo", priority: (5 - Math.min(4, Math.max(1, tp))) as Priority, tags: labels,
      due: parsed?.due ?? null, time: parsed?.time ?? null, recurrence: parsed?.recurrence ?? null, source: "todoist",
      duration: col(r, "DURATION") ? Number(col(r, "DURATION")) * (col(r, "DURATION_UNIT").toLowerCase().startsWith("day") ? 1440 : 1) || null : null,
      order: Date.now() + n,
    }, DEVICE);
    parents[indent - 1] = id; parents.length = indent;
    const { id: _i, ...fields } = task; void _i;
    put("tasks", id, fields);
    n++;
  }
  put("projects", pid, { columns });
  return n;
}

export function restoreBackup(x: { app?: string; data?: unknown }) {
  if (x?.app !== "cadence" || !x.data) throw new Error("This isn't a Cadence backup.");
  return x.data;
}

export const dateStamp = () => { const d = new Date(); return `${today()}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
