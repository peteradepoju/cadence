import { addDays, dayOfWeek, DAY_LONG, today } from "../dates";
import { generateJson } from "../gemini";
import { all, settings } from "../store";
import { committedOn, countOn, dailyBudget, dayCapacity, nextSlot, propose, waiting, type Placement } from "./hub";
import type { ShelfItem } from "../model";

// Phase 3: the pass that weighs rather than packs.
//
// The arithmetic planner in hub.ts fills days in order. It is honest but blunt: five courses that
// together want fourteen hours a day all get an equal claim, so you end up nibbling at all of them
// instead of finishing any. This asks the AI to choose — which course gets today, what waits, what
// is honestly not happening this fortnight — and then checks its answer against the same rules the
// arithmetic planner obeys, because a plan that quietly breaks a Saturday lock is worse than none.

export interface AiPlan {
  placements: Placement[];
  /** Two or three sentences on the shape of the fortnight. */
  note: string;
  /** Work the AI is openly not planning, and why. Shown rather than hidden. */
  dropped: { shelfId: string; title: string; why: string }[];
  /** True when the AI could not be used and this is the arithmetic plan instead. */
  fellBack: boolean;
}

interface RawPlacement { id?: string; date?: string; minutes?: number; why?: string }
interface RawPlan { plan?: RawPlacement[]; note?: string; dropped?: { id?: string; why?: string }[] }

/** What the AI is told about one piece of waiting work. */
function describe(s: ShelfItem) {
  return {
    id: s.id,
    title: s.title.slice(0, 120),
    from: s.sourceId,
    offered: s.offeredFor,
    minutes: s.duration,
    mustBeOn: s.dayLock == null ? null : DAY_LONG[s.dayLock],
    streak: s.streak || undefined,
    gate: s.gate || undefined,
    priority: s.priority,
  };
}

/** What each day already holds, so the AI plans into real gaps rather than an empty week. */
function daysAhead(from: string, days: number) {
  const budget = dailyBudget();
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    const free = Math.max(0, Math.min(dayCapacity() - committedOn(d), budget));
    return { date: d, weekday: DAY_LONG[dayOfWeek(d)], yourTasks: countOn(d), minutesFree: free };
  });
}

/** How much got finished lately, per source: the AI should not keep feeding a course you ignore. */
function recentlyDone(): Record<string, number> {
  const since = addDays(today(), -14);
  const out: Record<string, number> = {};
  for (const t of all("tasks")) {
    if (!t.done || !t.doneAt || t.doneAt.slice(0, 10) < since || !t.source) continue;
    out[t.source] = (out[t.source] ?? 0) + 1;
  }
  return out;
}

function prompt(from: string, days: number, items: ShelfItem[]): string {
  const s = settings();
  return `You plan one person's next ${days} days. They run several courses and apps at once, and together those ask for far more hours than a day holds, so your job is to CHOOSE, not to fit everything in.

Their day: work between ${s.dayStart} and ${s.dayEnd}. Energy is ${s.energy.morning} in the morning, ${s.energy.afternoon} in the afternoon, ${s.energy.evening} in the evening. At most ${s.dailyLimit} tasks a day. At most ${dailyBudget()} minutes a day may go to this imported work; the rest of the day is their own.

Rules you must not break:
- "mustBeOn" means the item belongs to that weekday. Plan it on that weekday or not at all.
- Never give a day more imported minutes than its "minutesFree".
- Only use dates from the list of days, and only ids from the list of work.
- A "gate" item unblocks the rest of its app, so plan it or say why not.
- A "streak" item breaks if missed: a short session beats skipping it, so you may shorten it.

How to choose:
- Rotate. One or two courses a day, carried for several days, beats touching five every day.
- Protect what has a real deadline, and what breaks if missed.
- Look at "finishedLately": work on a source they are actually doing, not one they ignore.
- Leave slack. A day planned to the minute is a day that fails.
- Say plainly what you are not planning. Do not quietly drop it.

Days: ${JSON.stringify(daysAhead(from, days))}
Finished in the last fortnight, by source: ${JSON.stringify(recentlyDone())}
Work waiting: ${JSON.stringify(items.map(describe))}

Return JSON only:
{"plan":[{"id":"<id>","date":"YYYY-MM-DD","minutes":<number>,"why":"a few words"}],
 "note":"two or three sentences on the shape of the fortnight",
 "dropped":[{"id":"<id>","why":"why it isn't happening"}]}`;
}

/**
 * Checks the AI's plan against the rules it was given and repairs what it can.
 *
 * The AI is good at choosing and bad at arithmetic, so nothing it says about dates or minutes is
 * taken on trust: a day-locked item on the wrong weekday is moved to the right one, a day over
 * budget sheds its last items, and anything left over goes back to the arithmetic planner.
 */
export function vet(raw: RawPlan, items: ShelfItem[], from: string, days: number): { placements: Placement[]; dropped: AiPlan["dropped"] } {
  const byId = new Map(items.map(i => [i.id, i]));
  const last = addDays(from, days - 1);
  const budget = dailyBudget();
  const limit = settings().dailyLimit;

  const used: Record<string, number> = {};
  const placed: Record<string, number> = {};
  for (let i = 0; i < days; i++) { const d = addDays(from, i); used[d] = committedOn(d); placed[d] = countOn(d); }

  const placements: Placement[] = [];
  const seen = new Set<string>();

  for (const r of raw.plan ?? []) {
    const item = r.id ? byId.get(r.id) : undefined;
    if (!item || seen.has(item.id)) continue;
    let date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : item.offeredFor ?? from;
    if (date < from) date = from;
    if (date > last) continue; // outside the window it was given

    let moved = date !== (item.offeredFor ?? from);

    // A day-locked item may only sit on its own weekday.
    if (item.dayLock != null && dayOfWeek(date) !== item.dayLock) {
      date = nextSlot(item, addDays(date, -1));
      moved = true;
      if (date > last) continue;
    }

    // Never longer than the item actually is, and never longer than the day has left.
    const want = Math.max(10, Math.min(Number(r.minutes) || item.duration || 30, item.duration ?? 180));
    // used[] starts at what the day already held, so imported minutes are the difference.
    const free = Math.max(0, Math.min(dayCapacity() - (used[date] ?? 0), budget - ((used[date] ?? 0) - committedOn(date))));

    if ((placed[date] ?? 0) >= limit) continue;         // the day is full of tasks
    if (free < 10) continue;                             // and of minutes
    const minutes = Math.min(want, free);
    if (minutes < want && !item.streak && minutes < 20) continue; // too little to be worth placing

    used[date] = (used[date] ?? 0) + minutes;
    placed[date] = (placed[date] ?? 0) + 1;
    seen.add(item.id);
    placements.push({ shelfId: item.id, date, minutes, moved, why: String(r.why ?? "").slice(0, 80) || (moved ? "moved to make the day work" : "chosen for this day") });
  }

  const dropped: AiPlan["dropped"] = [];
  for (const d of raw.dropped ?? []) {
    const item = d.id ? byId.get(d.id) : undefined;
    if (!item || seen.has(item.id)) continue;
    dropped.push({ shelfId: item.id, title: item.title, why: String(d.why ?? "").slice(0, 120) || "not this fortnight" });
    seen.add(item.id);
  }

  // Anything the AI forgot altogether is neither planned nor silently lost.
  for (const item of items) {
    if (seen.has(item.id)) continue;
    dropped.push({ shelfId: item.id, title: item.title, why: "no room in the fortnight" });
  }

  return { placements, dropped };
}

/** Asks the AI for a fortnight, checks it, and falls back to the arithmetic plan if it can't. */
export async function aiPlan(from = today(), days = 14): Promise<AiPlan> {
  const items = waiting();
  const fallback = (): AiPlan => ({
    placements: propose(from, days),
    note: "",
    dropped: [],
    fellBack: true,
  });
  if (!items.length) return { placements: [], note: "", dropped: [], fellBack: false };

  const s = settings();
  let raw: RawPlan;
  try {
    raw = await generateJson<RawPlan>(s.aiKey, prompt(from, days, items.slice(0, 120)), { model: s.aiModel || undefined });
  } catch {
    return fallback();
  }

  const { placements, dropped } = vet(raw, items, from, days);
  // A plan that placed almost nothing is worse than the arithmetic one.
  if (!placements.length) return fallback();
  return { placements, dropped, note: String(raw.note ?? "").slice(0, 400), fellBack: false };
}


