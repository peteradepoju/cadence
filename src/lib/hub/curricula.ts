import { addDays, dayOfWeek } from "../dates";
import type { HubKind } from "./types";

// Four of the courses need no account and no key: their shape is fixed (week N, day D), so once
// Cadence knows where you are it can work out what any date asks of you. Nothing is fetched.

export interface Slot {
  /** 0–6, Sunday = 0. */
  weekday: number;
  kind: HubKind;
  /** "Lesson", "Project", "Review" — what this slot is called in that course. */
  label: string;
  minutes: number;
  /** Misses a review and the spaced repetition falls apart, so these resist being pushed. */
  streak?: boolean;
}

export interface Curriculum {
  id: string;
  name: string;
  blurb: string;
  site: string;
  weeks: number;
  /** One week's slots, in the order the course numbers them: slot 0 is "D1". */
  slots: Slot[];
  /** When true a slot belongs to its weekday, so a deferral moves it seven days, not one. */
  dayBound: boolean;
}

const lesson = (weekday: number, minutes: number): Slot => ({ weekday, kind: "lesson", label: "Lesson", minutes });

export const CURRICULA: Curriculum[] = [
  {
    id: "stackway", name: "Stackway", blurb: "Zero to full-stack, 52 weeks.", site: "https://bobo-dev.vercel.app", weeks: 52, dayBound: true,
    slots: [
      lesson(1, 180), lesson(2, 180), lesson(3, 180), lesson(4, 180), lesson(5, 180),
      { weekday: 6, kind: "project", label: "Project", minutes: 180 },
      { weekday: 0, kind: "review", label: "Flashcard review", minutes: 45, streak: true },
    ],
  },
  {
    id: "python-atlas", name: "Python Atlas", blurb: "Python from nothing to mastery, 104 weeks.", site: "https://peter-adepoju.github.io/python-atlas/", weeks: 104, dayBound: false,
    slots: [lesson(1, 180), lesson(2, 180), lesson(3, 180), lesson(4, 180), lesson(5, 180), lesson(6, 180)],
  },
  {
    id: "tracesmith", name: "Tracesmith", blurb: "QA, technical support and AI automation, 26 weeks.", site: "https://life-os-tracesmith.vercel.app", weeks: 26, dayBound: false,
    slots: [lesson(1, 120), lesson(2, 120), lesson(3, 120), lesson(4, 120), lesson(5, 120), lesson(6, 120)],
  },
  {
    id: "mamba", name: "MAMBA", blurb: "Mathematics, neuroscience and machine learning.", site: "https://peter-adepoju.github.io/math-neuro-ml/", weeks: 6, dayBound: false,
    slots: [lesson(1, 90), lesson(2, 90), lesson(4, 90), lesson(5, 90)],
  },
];

export const curriculumById = (id: string) => CURRICULA.find(c => c.id === id);

export interface Position { week: number; day: number }

/**
 * The date a course's day actually starts on.
 *
 * A day-bound course numbers its days by weekday — Stackway's day 6 is the Saturday project — so
 * saying "I'm on day 1" on a Thursday has to mean the coming Monday. Otherwise the whole course
 * runs three days out of phase for a year and the project lands midweek. A course that is merely
 * six-days-a-week has no such tie and starts when you say it does.
 */
export function alignedAnchor(c: Curriculum, anchorDate: string, anchor: Position): string {
  if (!c.dayBound) return anchorDate;
  const want = c.slots[anchor.day - 1]?.weekday;
  if (want == null) return anchorDate;
  return addDays(anchorDate, (want - dayOfWeek(anchorDate) + 7) % 7);
}

/**
 * Where a date falls in a course, given that on `anchorDate` you were at `anchor`.
 * Counts only the course's own working days, so a rest day never advances it and a date the
 * course doesn't use has nothing to do.
 */
export function positionOn(c: Curriculum, anchorDate: string, anchor: Position, date: string): Position | null {
  if (!c.slots.some(s => s.weekday === dayOfWeek(date))) return null; // a day this course doesn't use

  const start = alignedAnchor(c, anchorDate, anchor);
  const perWeek = c.slots.length;
  let steps = 0, guard = 0;
  if (date >= start) {
    for (let d = start; d < date && guard++ < 4000; d = addDays(d, 1)) if (c.slots.some(s => s.weekday === dayOfWeek(d))) steps++;
  } else {
    for (let d = date; d < start && guard++ < 4000; d = addDays(d, 1)) if (c.slots.some(s => s.weekday === dayOfWeek(d))) steps--;
  }

  const index = (anchor.week - 1) * perWeek + (anchor.day - 1) + steps;
  if (index < 0) return null; // before you started
  const week = Math.floor(index / perWeek) + 1;
  if (week > c.weeks) return null; // the course has finished
  return { week, day: (index % perWeek) + 1 };
}

export const slotFor = (c: Curriculum, day: number): Slot | undefined => c.slots[day - 1];
