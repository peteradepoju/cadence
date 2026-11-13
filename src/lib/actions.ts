import { addDays, dueMoment, today } from "./dates";
import { DEFAULT_COLUMNS, newTask, type Project, type Task, uid, PALETTE } from "./model";
import { nextDate } from "./recurrence";
import { all, create, DEVICE, get, put, remove, restore, settings } from "./store";

// Everything that changes tasks and projects goes through here, so the rules live in one place.

export function addTask(p: Partial<Task> & { title: string }): Task {
  const s = settings();
  const reminders = p.reminders ?? (p.time && s.defaultReminder != null ? [{ id: uid(), before: s.defaultReminder }] : []);
  const siblings = all("tasks").filter(t => t.projectId === (p.projectId ?? null) && t.parentId === (p.parentId ?? null) && !t.done);
  const order = p.order ?? (siblings.length ? Math.max(...siblings.map(t => t.order)) + 1 : Date.now());
  const project = p.projectId ? get("projects", p.projectId) : undefined;
  const column = p.column ?? (project ? project.columns.find(c => c.kind === "todo")?.id ?? null : null);
  for (const tag of p.tags ?? []) ensureTag(tag);
  return create("tasks", newTask({ ...p, reminders, order, column }, DEVICE));
}

export function ensureTag(name: string) {
  const id = name.toLowerCase();
  if (!get("tags", id)) put("tags", id, { name: id, color: PALETTE[all("tags").length % PALETTE.length], deleted: false });
}

export function updateTask(id: string, patch: Partial<Task>) {
  for (const tag of patch.tags ?? []) ensureTag(tag);
  return put("tasks", id, patch);
}

/**
 * Ticks a task off. A repeating task moves to its next date instead (and its subtasks reopen),
 * so it's one task with a history, not a pile of copies.
 * Returns what to call to undo it.
 */
export function completeTask(id: string, opts: { stamp?: string } = {}): () => void {
  const t = get("tasks", id);
  if (!t) return () => {};
  const project = t.projectId ? get("projects", t.projectId) : undefined;
  const doneCol = project?.columns.find(c => c.kind === "done")?.id ?? null;
  if (t.recurrence && t.due) {
    const from = t.recurrence.fromDone ? today() : t.due;
    let next = nextDate(t.recurrence, from);
    // A repeat that fell behind skips ahead to the next date that isn't in the past.
    let guard = 0;
    while (next && !t.recurrence.fromDone && next < today() && guard++ < 1000) next = nextDate(t.recurrence, next);
    const count = t.doneCount + 1;
    const ended = !next || (t.recurrence.count != null && count >= t.recurrence.count);
    const prev = put("tasks", id, ended
      ? { done: true, doneAt: new Date().toISOString(), doneCount: count, column: doneCol ?? t.column }
      : { due: next!, doneCount: count, plannedFor: null, column: project?.columns.find(c => c.kind === "todo")?.id ?? t.column }, opts);
    put("sessions", uid(), { taskId: id, start: new Date().toISOString(), minutes: 0, kind: "manual", note: `Done (${t.due})` });
    const subs = all("tasks").filter(s => s.parentId === id && s.done);
    if (!ended) subs.forEach(s => put("tasks", s.id, { done: false, doneAt: null }));
    return () => { put("tasks", id, prev); if (!ended) subs.forEach(s => put("tasks", s.id, { done: true })); };
  }
  const prev = put("tasks", id, { done: true, doneAt: new Date().toISOString(), column: doneCol ?? t.column }, opts);
  return () => put("tasks", id, prev);
}

export function reopenTask(id: string) {
  const t = get("tasks", id);
  if (!t) return;
  const project = t.projectId ? get("projects", t.projectId) : undefined;
  put("tasks", id, { done: false, doneAt: null, column: project?.columns.find(c => c.kind === "todo")?.id ?? t.column });
}

export function toggleTask(id: string): (() => void) | null {
  const t = get("tasks", id);
  if (!t) return null;
  if (t.done) { reopenTask(id); return () => completeTask(id); }
  return completeTask(id);
}

/** Deletes a task and its subtasks. Returns undo. */
export function deleteTask(id: string): () => void {
  const ids = [id, ...descendants(id)];
  ids.forEach(i => remove("tasks", i));
  return () => ids.forEach(i => restore("tasks", i));
}

export function descendants(id: string): string[] {
  const kids = all("tasks").filter(t => t.parentId === id).map(t => t.id);
  return kids.flatMap(k => [k, ...descendants(k)]);
}

export function setColumn(id: string, column: string) {
  const t = get("tasks", id);
  if (!t) return;
  const project = t.projectId ? get("projects", t.projectId) : undefined;
  const kind = project?.columns.find(c => c.id === column)?.kind;
  if (kind === "done" && !t.done) { completeTask(id); if (!t.recurrence) put("tasks", id, { column }); return; }
  put("tasks", id, { column, ...(kind !== "done" && t.done ? { done: false, doneAt: null } : {}) });
}

export function moveToProject(id: string, projectId: string | null) {
  const project = projectId ? get("projects", projectId) : undefined;
  const t = get("tasks", id);
  const column = project ? (project.columns.find(c => c.kind === (t?.done ? "done" : "todo"))?.id ?? null) : null;
  put("tasks", id, { projectId, column });
  for (const d of descendants(id)) put("tasks", d, { projectId, column: null });
}

/** Reschedules every overdue, unfinished task to `to` (end-of-day review, "carry forward"). */
export function carryForward(ids: string[], to = addDays(today(), 1)) {
  for (const id of ids) {
    const t = get("tasks", id);
    if (!t || t.done) continue;
    if (t.due && t.due < to) put("tasks", id, { due: to });
    else if (t.plannedFor && t.plannedFor < to) put("tasks", id, { plannedFor: to });
  }
}

export function addProject(p: Partial<Project> & { name: string }): Project {
  const projects = all("projects");
  return create("projects", {
    id: uid(), color: PALETTE[projects.length % PALETTE.length], emoji: "", order: projects.length, view: "list",
    columns: DEFAULT_COLUMNS.map(c => ({ ...c })), archived: false, favorite: false, notes: "", gList: null, createdAt: new Date().toISOString(),
    ...p,
  });
}

export function deleteProject(id: string, keepTasks: boolean) {
  for (const t of all("tasks").filter(t => t.projectId === id)) {
    if (keepTasks) put("tasks", t.id, { projectId: null, column: null }); else remove("tasks", t.id);
  }
  const p = get("projects", id);
  if (p?.gList) put("settings", "main", { gIgnore: [...settings().gIgnore, p.gList] });
  remove("projects", id);
}

// ── Questions views ask ────────────────────────────────────────────────────
export const isOverdue = (t: Task, ref = today()) => !t.done && !!t.due && t.due < ref;
export const isToday = (t: Task, ref = today()) => !t.done && ((!!t.due && t.due <= ref) || (!!t.plannedFor && t.plannedFor <= ref));
export const isOpen = (t: Task) => !t.done && !t.deleted;

/** The order tasks show in: time of day, then priority, then your own order. */
export function byDue(a: Task, b: Task) {
  const da = a.due ?? "9999", db = b.due ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.time ?? "99", tb = b.time ?? "99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.priority - b.priority || a.order - b.order;
}
export const byOrder = (a: Task, b: Task) => a.order - b.order;
export const byPriority = (a: Task, b: Task) => a.priority - b.priority || byDue(a, b);

export function dueAt(t: Task): Date | null { return t.due ? dueMoment(t.due, t.time) : null; }

/** Minutes logged on a task (focus sessions and manual logs). */
export function timeSpent(taskId: string): number {
  return all("sessions").filter(s => s.taskId === taskId).reduce((a, s) => a + s.minutes, 0);
}
