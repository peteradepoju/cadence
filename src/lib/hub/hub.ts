import { addDays, dayOfWeek, today } from "../dates";
import { addProject, addTask, completeTask, isOpen } from "../actions";
import type { ShelfItem, Task } from "../model";
import { all, create, get, put, settings } from "../store";
import { SOURCES } from "./sources";
import type { HubConfig, HubItem } from "./types";

// Pulling, shelving and placing. Nothing a source offers becomes a task on its own: it lands on
// the shelf, and only a day you accept is written.

export const shelfId = (sourceId: string, externalId: string) => `${sourceId}:${externalId}`;

export const configFor = (sourceId: string): HubConfig => settings().hub?.[sourceId] ?? {};
export function setConfig(sourceId: string, patch: Partial<HubConfig>) {
  const hub = { ...(settings().hub ?? {}) };
  hub[sourceId] = { ...(hub[sourceId] ?? {}), ...patch };
  put("settings", "main", { hub });
}

export const enabledSources = () => SOURCES.filter(s => configFor(s.id).on && !s.problem(configFor(s.id)));

/** How far ahead the hub looks. A fortnight is enough to see a week-long deferral land. */
export const HORIZON = 13;

export interface PullResult { added: number; updated: number; removed: number; placed: number }

/**
 * Runs every switched-on source and reconciles the shelf.
 * Matching is by sourceId + externalId, so running this every morning never duplicates work.
 */
export async function pull(from = today(), to = addDays(today(), HORIZON)): Promise<PullResult> {
  const r: PullResult = { added: 0, updated: 0, removed: 0, placed: 0 };
  const seen = new Set<string>();

  for (const source of enabledSources()) {
    let items: HubItem[] = [];
    try {
      items = await source.items({ from, to, config: configFor(source.id) });
    } catch {
      continue; // one source failing must not stop the rest
    }
    for (const item of items) {
      const id = shelfId(item.sourceId, item.externalId);
      seen.add(id);
      const existing = get("shelf", id);

      if (item.doneOutside) {
        if (existing?.taskId) {
          // Read in the app it came from, so tick it off here rather than leaving it staring at you.
          const t = get("tasks", existing.taskId);
          if (t && !t.done) completeTask(existing.taskId);
        } else if (existing && !existing.decidedAt) {
          put("shelf", id, { decidedAt: new Date().toISOString(), outcome: "done-elsewhere" });
          r.removed++;
        }
        continue;
      }

      const fields = {
        sourceId: item.sourceId,
        externalId: item.externalId,
        title: item.title,
        notes: item.notes ?? "",
        url: item.url ?? null,
        offeredFor: item.due ?? null,
        time: item.time ?? null,
        duration: item.duration ?? null,
        dayLock: item.dayLock ?? null,
        streak: !!item.streak,
        gate: !!item.gate,
        auto: !!item.auto,
        priority: item.priority ?? 3,
        project: item.project ?? null,
        tags: item.tags ?? [],
        kind: item.kind ?? "lesson",
      };

      if (!existing) {
        create("shelf", { id, ...fields, pulledAt: new Date().toISOString(), decidedAt: null, outcome: null, taskId: null });
        r.added++;
      } else if (!existing.decidedAt) {
        // Only re-describe what hasn't been decided; an accepted item belongs to its task now.
        const before = JSON.stringify([existing.title, existing.offeredFor, existing.duration]);
        put("shelf", id, fields);
        if (JSON.stringify([fields.title, fields.offeredFor, fields.duration]) !== before) r.updated++;
      }
    }
  }

  r.placed = placeAutomatic();

  // An undecided item the source stopped offering (you changed your week, or a plan ended) goes.
  for (const s of all("shelf")) {
    if (s.decidedAt || seen.has(s.id)) continue;
    if (!enabledSources().some(x => x.id === s.sourceId)) continue; // source switched off: leave it
    put("shelf", s.id, { deleted: true });
    r.removed++;
  }
  return r;
}

/**
 * Writes the items an app marked as not-a-suggestion straight onto their day.
 *
 * These skip the shelf's whole point on purpose: the app is saying this belongs on that day
 * whatever else is happening, so asking about it every morning would be noise. They are placed on
 * the day they were offered for (today, if that day has gone), and they count against the day's
 * budget afterwards like any other task, so the planner sees them and plans around them.
 */
export function placeAutomatic(from = today()): number {
  let n = 0;
  for (const item of all("shelf")) {
    if (item.decidedAt || !item.auto || !item.offeredFor) continue;
    const date = item.offeredFor < from ? from : item.offeredFor;
    accept({ shelfId: item.id, date, minutes: item.duration ?? 30, moved: false, why: "added for you" });
    n++;
  }
  return n;
}

/** Everything still waiting for a decision, soonest first. */
export const waiting = (): ShelfItem[] =>
  all("shelf")
    .filter(s => !s.decidedAt)
    .sort((a, b) => (a.offeredFor ?? "9999").localeCompare(b.offeredFor ?? "9999") || a.priority - b.priority);

// ── Placing a day ──────────────────────────────────────────────────────────

/**
 * The next date an item can take, from `after`.
 *
 * A day-bound item keeps its weekday, so a Saturday project that will not fit moves to the next
 * Saturday rather than to Sunday. Everything else moves a day at a time.
 */
export function nextSlot(item: Pick<ShelfItem, "dayLock">, after: string): string {
  if (item.dayLock == null) return addDays(after, 1);
  let d = addDays(after, 1);
  for (let i = 0; i < 7 && dayOfWeek(d) !== item.dayLock; i++) d = addDays(d, 1);
  return d;
}

/** Minutes already committed on a date: tasks with a duration, plus time blocks. */
export function committedOn(date: string): number {
  const fromTasks = all("tasks")
    .filter(t => isOpen(t) && !t.parentId && (t.due === date || (!t.due && t.plannedFor === date)))
    .reduce((n, t) => n + (t.duration ?? 0), 0);
  const fromBlocks = all("blocks")
    .filter(b => b.date === date && !b.taskId)
    .reduce((n, b) => n + Math.max(0, mins(b.end) - mins(b.start)), 0);
  return fromTasks + fromBlocks;
}
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** How many minutes the working day holds in total. */
export function dayCapacity(): number {
  const s = settings();
  return Math.max(0, mins(s.dayEnd) - mins(s.dayStart));
}

/**
 * How much of a day imported work may take.
 *
 * Your courses alone ask for about fourteen hours a day, and the working day holds ten, so
 * filling the day to its brim with study is the overload rather than the fix. The hub claims only
 * this much, leaves the rest for your own work, and moves what doesn't fit to another day.
 */
export const dailyBudget = () => Math.max(0, Math.min(settings().hubDaily ?? 240, dayCapacity()));

/** Open, unparented tasks already sitting on a date. */
export const countOn = (date: string) =>
  all("tasks").filter(t => isOpen(t) && !t.parentId && (t.due === date || (!t.due && t.plannedFor === date))).length;

export interface Placement {
  shelfId: string;
  /** The date it is proposed for, which may not be the date it was offered for. */
  date: string;
  /** Minutes it will claim — less than its own duration when it had to be trimmed. */
  minutes: number;
  why: string;
  moved: boolean;
}

/**
 * Lays the waiting items over the days ahead without going past what the day holds.
 *
 * Deliberately plain arithmetic: the AI pass that weighs priorities comes next, and this is what
 * it has to beat. Items are taken soonest-first; anything that will not fit is moved on by its own
 * rules, and a streak item is trimmed to a token session rather than pushed.
 */
export function propose(from = today(), days = 7): Placement[] {
  const cap = dayCapacity();
  const budget = dailyBudget();
  const limit = settings().dailyLimit;
  const used: Record<string, number> = {};
  const placed: Record<string, number> = {};
  const imported: Record<string, number> = {};
  for (let i = 0; i < days + 7; i++) { const d = addDays(from, i); used[d] = committedOn(d); placed[d] = countOn(d); imported[d] = 0; }

  // Least flexible first. A Saturday project can only ever be a Saturday, so if a lesson that
  // could run any day takes the slot, the project is pushed a whole week — and then another, until
  // it drops off the horizon entirely. Items that can move freely are the ones that should.
  const order = [...waiting()].sort((a, b) =>
    (a.offeredFor ?? "9999").localeCompare(b.offeredFor ?? "9999")
    || (a.dayLock != null ? 0 : 1) - (b.dayLock != null ? 0 : 1)
    || (a.streak ? 0 : 1) - (b.streak ? 0 : 1)
    || a.priority - b.priority
    || (b.duration ?? 0) - (a.duration ?? 0));

  const out: Placement[] = [];
  for (const item of order) {
    const offered = item.offeredFor ?? from;
    let date = offered < from ? from : offered;
    let moved = false;
    let guard = 0;

    while (guard++ < 12) {
      // The day holds what's left of the working day, and no more of the hub's own budget.
      const room = Math.min(cap - (used[date] ?? 0), budget - (imported[date] ?? 0));
      const slots = limit - (placed[date] ?? 0);
      const want = item.duration ?? 30;

      if (slots > 0 && room >= want) break;
      // A streak item would rather be ten minutes today than nothing until next week.
      if (item.streak && slots > 0 && room >= 10) break;
      date = nextSlot(item, date);
      moved = true;
      if (date > addDays(from, days + 6)) break;
    }
    if (date > addDays(from, days + 6)) continue; // no room in the window at all

    const room = Math.max(0, Math.min(cap - (used[date] ?? 0), budget - (imported[date] ?? 0)));
    const minutes = Math.max(10, Math.min(item.duration ?? 30, room));
    used[date] = (used[date] ?? 0) + minutes;
    imported[date] = (imported[date] ?? 0) + minutes;
    placed[date] = (placed[date] ?? 0) + 1;

    out.push({
      shelfId: item.id,
      date,
      minutes,
      moved,
      why: !moved ? "fits the day it was set for"
        : item.dayLock != null ? `${dayName(item.dayLock)} was full, so the next ${dayName(item.dayLock)}`
        : item.streak ? "trimmed to keep the streak"
        : "that day already had its study time",
    });
  }
  return out;
}

const dayName = (n: number) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][n] ?? "that day";

/** Turns a placement into a real task and marks the shelf item decided. */
export function accept(p: Placement): Task | null {
  const item = get("shelf", p.shelfId);
  if (!item || item.decidedAt) return null;

  const projectId = item.project ? projectNamed(item.project) : null;
  const task = addTask({
    title: item.title,
    notes: item.notes,
    projectId,
    due: p.date,
    time: item.time,
    duration: p.minutes,
    priority: item.priority,
    tags: item.tags,
    link: item.url,
    source: item.sourceId,
    externalId: item.externalId,
    sourceUrl: item.url,
    dayLock: item.dayLock,
  });
  put("shelf", p.shelfId, { decidedAt: new Date().toISOString(), outcome: "accepted", taskId: task.id });
  return task;
}

/** Puts an item back out of the way without losing it: it can be offered again later. */
export function dismiss(id: string) {
  put("shelf", id, { decidedAt: new Date().toISOString(), outcome: "dismissed", taskId: null });
}

function projectNamed(name: string): string {
  const found = all("projects").find(p => p.name.toLowerCase() === name.toLowerCase());
  return found ? found.id : addProject({ name }).id;
}
