import type { Priority } from "../model";

// The hub: Cadence pulls work from your other apps, shelves it, and proposes a day you can accept.
//
// Everything an app offers arrives as a HubItem. Nothing else about the app reaches the rest of
// Cadence, so adding a tenth app is one `fetch` that returns HubItem[] — not a change to the
// planner, the shelf or the review screen.

export type HubKind = "lesson" | "review" | "reading" | "project" | "deadline" | "payment" | "application";

export interface HubItem {
  sourceId: string;
  /** Stable within that app. This, and only this, is what stops a daily sync duplicating work. */
  externalId: string;
  title: string;
  notes?: string;
  /** Deep link back into the app it came from. */
  url?: string | null;

  due?: string | null;      // YYYY-MM-DD, only when the app really has a date
  time?: string | null;     // HH:MM
  /** Minutes. Without this the planner cannot weigh the item against the day. */
  duration?: number | null;

  /** 0–6 (Sunday = 0): this belongs on that weekday, so it defers a week at a time, not a day. */
  dayLock?: number | null;
  /** Breaks if missed — shrink it before pushing it. */
  streak?: boolean;
  /** Blocks the rest of that app until it is done. */
  gate?: boolean;

  priority?: Priority;
  /** Suggested Cadence project name; created on first accept. */
  project?: string | null;
  tags?: string[];
  kind?: HubKind;
  /** Already finished over there — never offer it. */
  doneOutside?: boolean;
}

/** What a source keeps in Settings. Only `on` is common to all of them. */
export interface HubConfig {
  on?: boolean;
  /** Courses: where you were, and when you said so. */
  anchorDate?: string;
  week?: number;
  day?: number;
  /** Bible: which plan, and the day you started it. */
  planId?: string;
  startedAt?: string;
  /** Sources that need an address or a key (used from Phase 2 on). */
  url?: string;
  token?: string;
  /** Minutes a day to claim, when the source has no duration of its own. */
  minutes?: number;
}

export interface HubCtx {
  /** The window being asked for, inclusive. */
  from: string;
  to: string;
  config: HubConfig;
}

export type HubField = { key: keyof HubConfig; label: string; hint?: string; type: "text" | "date" | "number" | "plan" };

export interface HubSource {
  id: string;
  name: string;
  blurb: string;
  /** What you must supply before it can run. "none" means it works the moment you switch it on. */
  needs: "none" | "position" | "plan" | "url" | "token";
  fields: HubField[];
  /** Null when the config isn't usable yet — the Settings card then says so. */
  problem(config: HubConfig): string | null;
  items(ctx: HubCtx): HubItem[] | Promise<HubItem[]>;
}
