import { ALL_CHAPTERS, BOOKS, bookById, type Chapter } from "./books";
import { diffDays, today } from "../dates";

// A passage a day. Selah keeps its reading plans in your Drive, which Cadence (by design) cannot
// read, so Cadence works the passage out itself from the same plans and the same arithmetic.
// Tell it which plan and when you started, and both apps land on the same chapters.

export interface Plan { id: string; name: string; description: string; days: number; schedule: Chapter[][] }

const chaptersOf = (ids: string[]) => ids.flatMap(id => Array.from({ length: bookById(id)!.chapters }, (_, i) => [id, i + 1] as Chapter));

/** Splits chapters evenly over `days`, keeping their order. */
function spread(chapters: Chapter[], days: number): Chapter[][] {
  const out: Chapter[][] = [];
  for (let d = 0; d < days; d++) out.push(chapters.slice(Math.round((d * chapters.length) / days), Math.round(((d + 1) * chapters.length) / days)));
  return out;
}

const NT = BOOKS.filter(b => b.testament === "NT").map(b => b.id);

let cached: Plan[] | null = null;
/** Built on first use: the whole Bible is 1,189 chapters and the plans are only needed on the hub. */
export function plans(): Plan[] {
  if (cached) return cached;
  const psalms = chaptersOf(["Ps"]), proverbs = chaptersOf(["Prov"]);
  cached = [
    { id: "bible-year", name: "Bible in a year", description: "Genesis to Revelation, about 3–4 chapters a day.", days: 365, schedule: spread(ALL_CHAPTERS, 365) },
    { id: "nt-90", name: "New Testament in 90 days", description: "All 260 chapters, about 3 a day.", days: 90, schedule: spread(chaptersOf(NT), 90) },
    { id: "gospels-30", name: "The Gospels in 30 days", description: "Matthew, Mark, Luke and John, 3 chapters a day.", days: 30, schedule: spread(chaptersOf(["Matt", "Mark", "Luke", "John"]), 30) },
    {
      id: "psalms-proverbs-31", name: "Psalms & Proverbs in a month", description: "Five psalms and one proverb a day, for 31 days.", days: 31,
      schedule: Array.from({ length: 31 }, (_, d) => [...psalms.slice(Math.round((d * 150) / 31), Math.round(((d + 1) * 150) / 31)), proverbs[d]]),
    },
  ];
  return cached;
}

export const planById = (id: string) => plans().find(p => p.id === id);

/** Which day of the plan a date is, 1-based. */
export const planDay = (startedAt: string, date = today()) => diffDays(date, startedAt) + 1;

/** "Genesis 1–3", "Psalms 1–5, Proverbs 1" */
export function describeDay(chapters: Chapter[]): string {
  const groups: { book: string; from: number; to: number }[] = [];
  for (const [b, c] of chapters) {
    const g = groups[groups.length - 1];
    if (g && g.book === b && g.to === c - 1) g.to = c; else groups.push({ book: b, from: c, to: c });
  }
  return groups.map(g => `${bookById(g.book)?.name ?? g.book} ${g.from}${g.to !== g.from ? `–${g.to}` : ""}`).join(", ");
}

/** Roughly four minutes a chapter, which is about how long a chapter takes to read aloud. */
export const minutesFor = (chapters: Chapter[]) => Math.max(5, chapters.length * 4);
