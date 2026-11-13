import { addDays, dayOfWeek, diffDays, startOfWeek, today, weekKey, quarterKey, monthKey } from "./dates";
import type { Goal, Habit, HabitLog, Task } from "./model";
import { all, get, put, settings } from "./store";

// Habits, streaks and goal progress. Pure functions over the stored data, so every device agrees.

export const logId = (habitId: string, date: string) => `${habitId}:${date}`;

/** Is the habit expected on this day? ("weekly" habits can be done on any day.) */
export function dueOn(h: Habit, date: string): boolean {
  if (h.kind === "days") return h.days.includes(dayOfWeek(date));
  return true;
}

export function countOn(logs: Map<string, number>, h: Habit, date: string) { return logs.get(logId(h.id, date)) ?? 0; }
export function logMap(logs: HabitLog[] = all("habitLogs")): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) if (!l.deleted) m.set(l.id, l.count);
  return m;
}

export function tick(h: Habit, date: string, delta = 1) {
  const id = logId(h.id, date);
  const cur = get("habitLogs", id)?.count ?? 0;
  const next = Math.max(0, cur + delta);
  put("habitLogs", id, { habitId: h.id, date, count: next, deleted: false });
}
export function setCount(h: Habit, date: string, count: number) {
  put("habitLogs", logId(h.id, date), { habitId: h.id, date, count: Math.max(0, count), deleted: false });
}

/**
 * Streak: days (or, for weekly habits, weeks) in a row the habit was met. Today doesn't break a streak
 * until it's over, and days the habit isn't expected are skipped.
 */
export function streak(h: Habit, logs = logMap(), ref = today()): { current: number; best: number } {
  const target = Math.max(1, h.target);
  const created = h.createdAt.slice(0, 10);
  if (h.kind === "weekly") {
    const ws = settings().weekStart;
    const weekDone = (start: string) => { let n = 0; for (let i = 0; i < 7; i++) if (countOn(logs, h, addDays(start, i)) >= target) n++; return n >= Math.max(1, h.perWeek); };
    let cur = 0, best = 0, run = 0, counting = true;
    const firstWeek = startOfWeek(created, ws);
    for (let i = 0, w = startOfWeek(ref, ws); i < 260 && w >= firstWeek; i++, w = addDays(w, -7)) {
      if (weekDone(w)) { run++; if (counting) cur = run; }
      else if (i > 0) { counting = false; run = 0; } // this week isn't over yet
      best = Math.max(best, run);
    }
    return { current: cur, best: Math.max(best, cur) };
  }
  let cur = 0, best = 0, run = 0, counting = true;
  for (let i = 0, d = ref; i < 1500 && d >= created; i++, d = addDays(d, -1)) {
    if (!dueOn(h, d)) continue;
    const ok = countOn(logs, h, d) >= target;
    if (ok) { run++; if (counting) cur = run; }
    else {
      if (i === 0) continue; // today isn't over
      counting = false; run = 0;
    }
    best = Math.max(best, run);
  }
  return { current: cur, best: Math.max(best, cur) };
}

/** Share of expected days met over the last n days. */
export function rate(h: Habit, logs = logMap(), days = 30, ref = today()): number {
  let due = 0, met = 0;
  const created = h.createdAt.slice(0, 10);
  for (let i = 1; i <= days; i++) {
    const d = addDays(ref, -i);
    if (d < created) break;
    if (h.kind !== "weekly" && !dueOn(h, d)) continue;
    due++;
    if (countOn(logs, h, d) >= Math.max(1, h.target)) met++;
  }
  if (h.kind === "weekly") return Math.min(1, met / Math.max(1, (due / 7) * h.perWeek));
  return due ? met / due : 0;
}

export function weekCount(h: Habit, logs = logMap(), ref = today()): number {
  const start = startOfWeek(ref, settings().weekStart);
  let n = 0;
  for (let i = 0; i < 7; i++) if (countOn(logs, h, addDays(start, i)) >= Math.max(1, h.target)) n++;
  return n;
}

// ── Goals ──────────────────────────────────────────────────────────────────
export function currentPeriod(h: Goal["horizon"], ref = today()): string {
  return h === "year" ? ref.slice(0, 4) : h === "quarter" ? quarterKey(ref) : h === "month" ? monthKey(ref) : weekKey(ref);
}

/** Progress 0–100: set by hand, or from linked tasks and sub-goals. */
export function goalProgress(g: Goal, goals: Goal[] = all("goals"), tasks: Task[] = all("tasks"), depth = 0): number {
  if (g.progress != null) return g.progress;
  if (g.status === "done") return 100;
  const linked = tasks.filter(t => t.goalId === g.id && !t.parentId);
  const kids = depth < 5 ? goals.filter(x => x.parentId === g.id && x.status !== "dropped") : [];
  const parts: number[] = [...linked.map(t => (t.done ? 100 : 0)), ...kids.map(k => goalProgress(k, goals, tasks, depth + 1))];
  if (!parts.length) return 0;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

export function periodLabel(h: Goal["horizon"], p: string): string {
  if (h === "year") return p;
  if (h === "quarter") return p.replace("-", " ");
  if (h === "month") { const [y, m] = p.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
  return p.replace("-W", " week ");
}

export const daysLeftIn = (date: string, ref = today()) => diffDays(date, ref);
