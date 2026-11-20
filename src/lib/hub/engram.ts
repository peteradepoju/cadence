import { addDays, diffDays } from "../dates";
import { idb } from "../idb";
import { parseIcs } from "./ics";
import { FeedError, getText } from "./http";
import type { HubCtx, HubItem, HubSource } from "./types";

// Engram publishes its own course — 208 weeks and 305 papers — at a public address that already
// allows other sites to read it. So Cadence reads the course once, keeps it on the device, and
// works out your days from the date you started. No token, no sign-in, and it works offline after
// the first read.
//
// Euronia's paper of the day comes from the same document: Euronia reads Engram's position, and so
// can Cadence.

const SITE = "https://engram-neuroai.vercel.app";
const COURSE = `${SITE}/api/course`;
const VERSION = `${COURSE}/version`;
const CACHE = "engram:course";

export interface EngramWeek { n: number; kind: string; title: string }
export interface EngramPaper { id: string; week: number; day: number; title: string; authors?: string; year?: number; venue?: string; url?: string; why?: string; deepRead?: boolean; difficulty?: number }
export interface EngramCourse { version: string; weeks: EngramWeek[]; papers: EngramPaper[] }

/** A week with no study days: the course rests, and so should the plan. */
const isRest = (w: EngramWeek | undefined) => !w || w.kind === "rest";

/**
 * The course, from the device if it is current and from Engram if it is not.
 * The version endpoint is a few bytes, so this costs almost nothing on a day when nothing changed,
 * and a week added in Engram reaches Cadence on the next check.
 */
export async function course(fetchText = getText): Promise<EngramCourse> {
  const cached = await idb.get<EngramCourse>(CACHE).catch(() => undefined);
  let latest: string | null = null;
  try {
    latest = (JSON.parse(await fetchText(VERSION)) as { version?: string }).version ?? null;
  } catch {
    if (cached) return cached; // offline, or Engram is down: yesterday's copy is fine
    throw new FeedError("unreachable", "Couldn't reach Engram, and there's no copy on this device yet.");
  }
  if (cached && latest && cached.version === latest) return cached;

  const body = JSON.parse(await fetchText(COURSE)) as Partial<EngramCourse>;
  if (!Array.isArray(body.weeks)) throw new FeedError("shape", "Engram's course didn't look the way Cadence expects.");
  const fresh: EngramCourse = { version: body.version ?? latest ?? "", weeks: body.weeks, papers: Array.isArray(body.papers) ? body.papers : [] };
  await idb.set(CACHE, fresh).catch(() => {});
  return fresh;
}

/** Week 1 day 1 is the day you started; every week takes seven days, rest weeks included. */
export function engramPosition(startedAt: string, date: string): { week: number; day: number } | null {
  const offset = diffDays(date, startedAt);
  if (offset < 0) return null;
  const day = (offset % 7) + 1;
  if (day === 7) return null; // Engram studies six days a week
  return { week: Math.floor(offset / 7) + 1, day };
}

export const engramDateOf = (startedAt: string, week: number, day: number) => addDays(startedAt, (week - 1) * 7 + (day - 1));

const startProblem = (startedAt?: string) =>
  !startedAt ? "Say the date you started week 1."
  : !/^\d{4}-\d{2}-\d{2}$/.test(startedAt) ? "That date doesn't look right."
  : null;

export const engramSource: HubSource = {
  id: "engram",
  name: "Engram",
  blurb: "Your NeuroAI course: a lesson a day, six days a week.",
  needs: "position",
  fields: [
    { key: "startedAt", label: "Started week 1 on", type: "date" },
    { key: "url", label: "Calendar address", hint: "Optional. Engram's private feed gives each day's own title", type: "text" },
  ],
  problem(cfg) { return startProblem(cfg.startedAt); },

  async items({ from, to, config }: HubCtx): Promise<HubItem[]> {
    if (this.problem(config)) return [];
    const start = config.startedAt!;

    // The private feed names each day; the public course names each week. Prefer the feed when
    // one is set, and fall back rather than leaving the day empty if it can't be read.
    if (config.url) {
      try { return fromFeed(await getText(config.url), from, to); }
      catch { /* fall through to the public course */ }
    }

    const c = await course();
    const byWeek = new Map(c.weeks.map(w => [w.n, w]));
    const out: HubItem[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const pos = engramPosition(start, d);
      if (!pos) continue;
      const week = byWeek.get(pos.week);
      if (isRest(week)) continue;
      if (!week) continue; // past the end of the course
      out.push({
        sourceId: "engram",
        externalId: `w${pos.week}d${pos.day}`,
        title: `Engram · W${pos.week} D${pos.day}: ${week.title}`,
        notes: "Lesson, paper, review and journal.",
        url: `${SITE}/learn/w${String(pos.week).padStart(3, "0")}/d${pos.day}`,
        due: d,
        duration: 180,
        priority: 3,
        project: "Engram",
        tags: ["study"],
        kind: "lesson",
      });
    }
    return out;
  },
};

/** Engram's own iCalendar feed, when its address is set and Engram lets this site read it. */
function fromFeed(text: string, from: string, to: string): HubItem[] {
  const out: HubItem[] = [];
  for (const e of parseIcs(text)) {
    if (e.start < from || e.start > to) continue;
    if (/rest week/i.test(e.summary)) continue;
    const lesson = /^Engram\s+W(\d+)\s+D(\d+):\s*(.*)$/i.exec(e.summary);
    const papers = /^Engram\s+papers?\s+for\s+week\s+(\d+)/i.exec(e.summary);
    out.push({
      sourceId: "engram",
      externalId: lesson ? `w${lesson[1]}d${lesson[2]}` : e.uid,
      title: lesson ? `Engram · W${lesson[1]} D${lesson[2]}: ${lesson[3]}` : papers ? `Engram · week ${papers[1]} papers` : `Engram · ${e.summary}`,
      notes: e.description.split("\n")[0] ?? "",
      url: e.url,
      due: e.start,
      time: e.time,
      duration: papers ? 60 : 180,
      priority: 3,
      project: "Engram",
      tags: ["study"],
      kind: papers ? "reading" : "lesson",
    });
  }
  return out;
}

// ── Euronia: the paper of the day, from Engram's own list ──────────────────

const EURONIA = "https://euronia.vercel.app";

export const euroniaSource: HubSource = {
  id: "euronia",
  name: "Euronia",
  blurb: "The lab's paper of the day, from Engram's reading list.",
  needs: "position",
  fields: [
    { key: "startedAt", label: "Engram started on", hint: "The same date as Engram", type: "date" },
    { key: "minutes", label: "Minutes a day", type: "number" },
  ],
  problem(cfg) { return startProblem(cfg.startedAt); },

  async items({ from, to, config }: HubCtx): Promise<HubItem[]> {
    if (this.problem(config)) return [];
    const start = config.startedAt!;
    const c = await course();
    const byWeek = new Map(c.weeks.map(w => [w.n, w]));
    const minutes = config.minutes && config.minutes > 0 ? config.minutes : 60;

    const out: HubItem[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const pos = engramPosition(start, d);
      if (!pos || isRest(byWeek.get(pos.week))) continue;
      const paper = c.papers.find(p => p.week === pos.week && p.day === pos.day);
      if (!paper) continue;
      out.push({
        sourceId: "euronia",
        externalId: paper.id,
        title: `Euronia · ${paper.title}`,
        notes: [paper.authors, paper.year, paper.venue].filter(Boolean).join(" · ") + (paper.why ? `\n${paper.why}` : ""),
        url: EURONIA,
        due: d,
        duration: paper.deepRead ? Math.round(minutes * 1.5) : minutes,
        // The lab stays shut until the day's paper is read, so this is the last thing to slide.
        gate: true,
        streak: true,
        priority: 2,
        project: "Euronia",
        tags: ["study", "paper"],
        kind: "reading",
      });
    }
    return out;
  },
};
