import { diffDays, today, weekKey, quarterKey, monthKey } from "./dates";
import type { Goal, Task } from "./model";
import { all } from "./store";

// Goal periods and progress. Pure functions over the stored data, so every device agrees.
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
