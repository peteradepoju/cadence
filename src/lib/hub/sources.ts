import { addDays, DAY_LONG, dayOfWeek } from "../dates";
import { CURRICULA, positionOn, slotFor } from "./curricula";
import { describeDay, minutesFor, planById, planDay } from "./bible";
import { bookById } from "./books";
import type { HubCtx, HubItem, HubSource } from "./types";

// Every app Cadence pulls from, behind one interface. A new one is a `items()` that returns
// HubItem[] — the shelf, the planner and the review screen never learn that it exists.

const SELAH = "https://selah-hazel-one.vercel.app";

/** Each day in the window, oldest first. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const courseSources: HubSource[] = CURRICULA.map(c => ({
  id: c.id,
  name: c.name,
  blurb: c.blurb,
  needs: "position",
  fields: [
    { key: "week", label: "Week you're on", type: "number" },
    { key: "day", label: "Day within that week", type: "number" },
    { key: "anchorDate", label: "As of", hint: "The date those numbers were true", type: "date" },
  ],
  problem(cfg) {
    if (!cfg.anchorDate) return "Say which week and day you're on, and the date that was true.";
    if (!cfg.week || cfg.week < 1 || cfg.week > c.weeks) return `Week must be between 1 and ${c.weeks}.`;
    if (!cfg.day || cfg.day < 1 || cfg.day > c.slots.length) return `${c.name} has ${c.slots.length} days in a week.`;
    return null;
  },
  items({ from, to, config }: HubCtx) {
    if (this.problem(config)) return [];
    const anchor = { week: config.week!, day: config.day! };
    const out: HubItem[] = [];
    for (const date of eachDay(from, to)) {
      const pos = positionOn(c, config.anchorDate!, anchor, date);
      if (!pos) continue;
      const slot = slotFor(c, pos.day);
      if (!slot) continue;
      out.push({
        sourceId: c.id,
        externalId: `w${pos.week}d${pos.day}`,
        title: `${c.name} · Week ${pos.week} ${slot.label} ${pos.day}`,
        notes: slot.kind === "project" ? "The week's project." : "",
        url: c.site,
        due: date,
        duration: slot.minutes,
        dayLock: c.dayBound ? slot.weekday : null,
        streak: slot.streak,
        priority: 3,
        project: c.name,
        tags: ["study"],
        kind: slot.kind,
      });
    }
    return out;
  },
}));

/** A passage a day, worked out the way Selah works it out, and opened in Selah's reader. */
const bibleSource: HubSource = {
  id: "bible",
  name: "Bible passage",
  blurb: "The day's reading from a plan, opened in Selah.",
  needs: "plan",
  fields: [
    { key: "planId", label: "Plan", type: "plan" },
    { key: "startedAt", label: "Started on", type: "date" },
  ],
  problem(cfg) {
    if (!cfg.planId) return "Choose a reading plan.";
    if (!planById(cfg.planId)) return "That plan is no longer available.";
    if (!cfg.startedAt) return "Say when you started it.";
    return null;
  },
  items({ from, to, config }: HubCtx) {
    if (this.problem(config)) return [];
    const plan = planById(config.planId!)!;
    const out: HubItem[] = [];
    for (const date of eachDay(from, to)) {
      const day = planDay(config.startedAt!, date);
      if (day < 1 || day > plan.days) continue;
      const chapters = plan.schedule[day - 1];
      if (!chapters?.length) continue;
      const [book, chapter] = chapters[0];
      out.push({
        sourceId: "bible",
        externalId: `${plan.id}:d${day}`,
        title: describeDay(chapters),
        notes: `${plan.name} · day ${day} of ${plan.days}`,
        url: `${SELAH}/bible/${bookById(book)?.id ?? book}/${chapter}`,
        due: date,
        duration: minutesFor(chapters),
        // The reading belongs to its own day: a missed Tuesday is not read twice on Wednesday,
        // it is simply the day you were behind. Streak-protected so it shrinks before it moves.
        dayLock: null,
        streak: true,
        priority: 2,
        project: "Bible",
        tags: ["bible"],
        kind: "reading",
      });
    }
    return out;
  },
};

export const SOURCES: HubSource[] = [bibleSource, ...courseSources];
export const sourceById = (id: string) => SOURCES.find(s => s.id === id);

/** "Saturday" — used when explaining why something moved a week. */
export const weekdayName = (n: number) => DAY_LONG[n] ?? "";
export const weekdayOf = (date: string) => dayOfWeek(date);
