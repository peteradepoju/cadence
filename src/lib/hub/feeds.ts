import { FeedError, getText } from "./http";
import type { HubCtx, HubItem, HubKind, HubSource } from "./types";

// Sources that live on the web rather than in a fixed curriculum.
//
// Two shapes cover everything: a published iCalendar feed, and a small JSON document any app can
// serve. Adding a tenth app means serving that JSON — no change here.

const inWindow = (d: string, from: string, to: string) => d >= from && d <= to;

// ── Any app at all: a small JSON document ──────────────────────────────────

/**
 * The format an app serves to join the hub. Every field but `id` and `title` is optional, and the
 * document may be a bare array or `{ "items": [...] }`.
 *
 * [{ "id": "task-42", "title": "Pay the tailor", "due": "2026-11-28", "minutes": 20,
 *    "url": "https://…", "dayLock": 6, "streak": false, "gate": false, "priority": 2,
 *    "project": "Selah", "tags": ["money"], "kind": "payment", "done": false }]
 */
interface FeedRow {
  id?: string; title?: string; notes?: string; url?: string;
  due?: string; date?: string; time?: string; minutes?: number; duration?: number;
  dayLock?: number; streak?: boolean; gate?: boolean; auto?: boolean; priority?: number;
  project?: string; tags?: string[]; kind?: string; done?: boolean;
}

const KINDS: HubKind[] = ["lesson", "review", "reading", "project", "deadline", "payment", "application"];

export function rowsToItems(sourceId: string, body: unknown, project: string, from: string, to: string): HubItem[] {
  const rows: FeedRow[] = Array.isArray(body) ? body
    : body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items) ? (body as { items: FeedRow[] }).items
    : (() => { throw new FeedError("shape", "The feed should be a list of items, or an object with an \"items\" list."); })();

  const out: HubItem[] = [];
  for (const r of rows) {
    const title = String(r.title ?? "").trim();
    if (!title) continue;
    const due = r.due ?? r.date ?? null;
    if (due && !inWindow(due, from, to)) continue;
    const minutes = r.minutes ?? r.duration ?? null;
    out.push({
      sourceId,
      externalId: String(r.id ?? title),
      title,
      notes: r.notes ?? "",
      url: r.url ?? null,
      due,
      time: r.time ?? null,
      duration: typeof minutes === "number" && minutes > 0 ? minutes : null,
      dayLock: typeof r.dayLock === "number" && r.dayLock >= 0 && r.dayLock <= 6 ? r.dayLock : null,
      streak: !!r.streak,
      gate: !!r.gate,
      auto: !!r.auto,
      priority: ([1, 2, 3, 4] as const).find(p => p === r.priority) ?? 3,
      project: r.project ?? project,
      tags: Array.isArray(r.tags) ? r.tags.filter(t => typeof t === "string") : [],
      kind: (KINDS as string[]).includes(String(r.kind)) ? (r.kind as HubKind) : "deadline",
      doneOutside: !!r.done,
    });
  }
  return out;
}

/** Builds a source for any app that serves the JSON above. */
export function jsonFeedSource(opts: { id: string; name: string; blurb: string; project: string }): HubSource {
  return {
    id: opts.id,
    name: opts.name,
    blurb: opts.blurb,
    needs: "url",
    fields: [
      { key: "url", label: "Feed address", hint: "Where the app serves its Cadence feed", type: "text" },
      { key: "token", label: "Token", hint: "If the feed needs one", type: "text" },
    ],
    problem(cfg) {
      if (!cfg.url) return `${opts.name} has to serve a Cadence feed first — see Settings for the format.`;
      if (!/^https?:\/\//i.test(cfg.url)) return "That doesn't look like a web address.";
      return null;
    },
    async items({ from, to, config }: HubCtx) {
      if (this.problem(config)) return [];
      const text = await getText(config.url!, config.token);
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new FeedError("shape", "That address didn't answer with JSON."); }
      return rowsToItems(opts.id, body, opts.project, from, to);
    },
  };
}

export const selahSource = jsonFeedSource({ id: "selah", name: "Selah", blurb: "Reminders, loan repayments and anything else Selah is holding.", project: "Selah" });
export const lifeOsSource = jsonFeedSource({ id: "life-os", name: "Life OS", blurb: "Deadlines, applications and tracked items.", project: "Life OS" });
