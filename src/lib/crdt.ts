// Every record syncs field by field, so edits made on two devices at the same time both survive.
//
// A record is { id, f: fields, t: a stamp per field }. A stamp is a hybrid logical clock:
// wall-clock milliseconds, a counter for edits in the same millisecond, and the device that made
// the edit. Stamps are fixed-width strings, so comparing two stamps is a plain string comparison.
// Merging two copies of a record keeps, for each field, the value with the newer stamp.
// Deleting is just another field ("deleted": true), so a delete also wins or loses by its stamp
// and a deleted record can never come back from an older copy.

export type Stamp = string;
export type Fields = Record<string, unknown>;
export interface Rec { id: string; f: Fields; t: Record<string, Stamp> }
export type Collection = Record<string, Rec>;
export type DataSet = Record<string, Collection>;

const MS_W = 10, CTR_W = 4;
let lastMs = 0, counter = 0;

export function makeStamp(device: string, now = Date.now()): Stamp {
  if (now > lastMs) { lastMs = now; counter = 0; } else { counter++; }
  return `${lastMs.toString(36).padStart(MS_W, "0")}${counter.toString(36).padStart(CTR_W, "0")}${device}`;
}

/** Moves the local clock past a stamp seen from another device, so a later local edit always sorts after it. */
export function observe(stamp: Stamp) {
  const ms = parseInt(stamp.slice(0, MS_W), 36);
  const ctr = parseInt(stamp.slice(MS_W, MS_W + CTR_W), 36);
  if (ms > lastMs || (ms === lastMs && ctr > counter)) { lastMs = ms; counter = ctr; }
}

export const stampMs = (s: Stamp) => parseInt(s.slice(0, MS_W), 36);
export const stampDevice = (s: Stamp) => s.slice(MS_W + CTR_W);
/** A stamp for an edit that happened somewhere else at a known time (Google Tasks, Google Calendar). */
export const stampAt = (ms: number, source: string): Stamp => `${Math.max(0, Math.floor(ms)).toString(36).padStart(MS_W, "0")}${"0".repeat(CTR_W)}${source}`;

export function setFields(rec: Rec | undefined, id: string, patch: Fields, stamp: Stamp): Rec {
  const r: Rec = rec ? { id, f: { ...rec.f }, t: { ...rec.t } } : { id, f: {}, t: {} };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    r.f[k] = v;
    r.t[k] = stamp;
  }
  return r;
}

/** Merges two copies of one record. Returns `a` itself when `b` adds nothing, so callers can tell nothing changed. */
export function mergeRec(a: Rec | undefined, b: Rec): Rec {
  if (!a) return b;
  let out: Rec | null = null;
  for (const [k, sb] of Object.entries(b.t)) {
    const sa = a.t[k];
    if (sa === undefined || sb > sa) {
      if (!out) out = { id: a.id, f: { ...a.f }, t: { ...a.t } };
      out.f[k] = b.f[k];
      out.t[k] = sb;
    }
  }
  return out ?? a;
}

/** Merges `incoming` into `base` and lists which records changed. */
export function mergeData(base: DataSet, incoming: DataSet): { data: DataSet; changed: { coll: string; id: string }[] } {
  const data: DataSet = { ...base };
  const changed: { coll: string; id: string }[] = [];
  for (const [coll, recs] of Object.entries(incoming ?? {})) {
    if (!recs || typeof recs !== "object") continue;
    let c = data[coll];
    for (const [id, rec] of Object.entries(recs)) {
      if (!isRec(rec)) continue;
      const before = c?.[id];
      const after = mergeRec(before, rec);
      if (after !== before) {
        if (c === base[coll]) c = { ...(c ?? {}) };
        c![id] = after;
        changed.push({ coll, id });
        for (const s of Object.values(rec.t)) observe(s);
      }
    }
    if (c) data[coll] = c;
  }
  return { data, changed };
}

function isRec(r: unknown): r is Rec {
  const x = r as Rec;
  return !!x && typeof x.id === "string" && !!x.f && !!x.t && typeof x.f === "object" && typeof x.t === "object";
}

/** True when `a` already holds everything in `b` (every field of b is in a with the same or a newer stamp). */
export function dominates(a: DataSet, b: DataSet): boolean {
  for (const [coll, recs] of Object.entries(b ?? {})) {
    for (const [id, rec] of Object.entries(recs ?? {})) {
      const mine = a[coll]?.[id];
      if (!mine) return false;
      for (const [k, s] of Object.entries(rec.t)) if (!mine.t[k] || mine.t[k] < s) return false;
    }
  }
  return true;
}

/** The newest stamp on a record, or "" for none. */
export function lastStamp(r: Rec, fields?: string[]): Stamp {
  let best = "";
  for (const [k, s] of Object.entries(r.t)) if ((!fields || fields.includes(k)) && s > best) best = s;
  return best;
}

/**
 * A deleted record only needs its "deleted" field to keep winning, so its other fields are dropped
 * once it has been deleted for a while. That keeps the data small without letting it come back.
 */
export function slimTombstones(data: DataSet, olderThanMs: number, now = Date.now()): DataSet {
  const out: DataSet = {};
  for (const [coll, recs] of Object.entries(data)) {
    const c: Collection = {};
    for (const [id, r] of Object.entries(recs)) {
      if (r.f.deleted === true && now - stampMs(r.t.deleted) > olderThanMs && Object.keys(r.f).length > 1) {
        // An older copy may still carry the dropped fields; merging them back is harmless, because "deleted" keeps winning.
        c[id] = { id, f: { deleted: true }, t: { deleted: r.t.deleted } };
      } else c[id] = r;
    }
    out[coll] = c;
  }
  return out;
}
