import { useSyncExternalStore } from "react";
import { type Collection, type DataSet, type Fields, makeStamp, mergeData, setFields } from "./crdt";
import { idb } from "./idb";
import { COLLECTIONS, type CollName, type Collections, DEFAULT_SETTINGS, type Settings } from "./model";

// The app's data: one in-memory copy, saved on the device and synced to Drive.
// Reads are synchronous; writes stamp only the fields that changed.

function deviceId(): string {
  try {
    let d = localStorage.getItem("cadence:device");
    if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(5)), x => (x % 36).toString(36)).join(""); localStorage.setItem("cadence:device", d); }
    return d;
  } catch { return "tmp" + Math.random().toString(36).slice(2, 6); }
}

export const DEVICE = typeof localStorage === "undefined" ? "test" : deviceId();

let data: DataSet = {};
const versions: Record<string, number> = {};
let globalVersion = 0;
const listeners = new Set<() => void>();
const localChangeListeners = new Set<() => void>();
const dirtyColls = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let ready = false;

const cache = new Map<string, { v: number; list: unknown[]; byId: Map<string, unknown> }>();

function emit(colls: Iterable<string>, local: boolean) {
  for (const c of colls) { versions[c] = (versions[c] ?? 0) + 1; dirtyColls.add(c); }
  globalVersion++;
  scheduleSave();
  listeners.forEach(l => l());
  if (local) localChangeListeners.forEach(l => l());
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 250);
}

export async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const colls = [...dirtyColls]; dirtyColls.clear();
  await Promise.all(colls.map(c => idb.set(`data:${c}`, data[c] ?? {}).catch(() => {})));
}

export async function loadStore() {
  const loaded: DataSet = {};
  await Promise.all(COLLECTIONS.map(async c => { loaded[c] = (await idb.get<Collection>(`data:${c}`).catch(() => undefined)) ?? {}; }));
  // Merge rather than replace: anything written before loading finished is kept.
  data = mergeData(loaded, data).data;
  ready = true;
  emit(COLLECTIONS, false);
}
export const isReady = () => ready;

function view<C extends CollName>(coll: C) {
  const v = versions[coll] ?? 0;
  const hit = cache.get(coll);
  if (hit && hit.v === v) return hit as { v: number; list: Collections[C][]; byId: Map<string, Collections[C]> };
  const byId = new Map<string, Collections[C]>();
  const list: Collections[C][] = [];
  for (const r of Object.values(data[coll] ?? {})) {
    const o = { ...(r.f as object), id: r.id } as Collections[C];
    byId.set(r.id, o);
    if (!(o as { deleted?: boolean }).deleted) list.push(o);
  }
  const entry = { v, list, byId };
  cache.set(coll, entry);
  return entry;
}

export function all<C extends CollName>(coll: C): Collections[C][] { return view(coll).list; }
export function get<C extends CollName>(coll: C, id: string): Collections[C] | undefined {
  const o = view(coll).byId.get(id);
  return o && !(o as { deleted?: boolean }).deleted ? o : undefined;
}
/** Includes deleted records (for sync code). */
export function getAny<C extends CollName>(coll: C, id: string): Collections[C] | undefined { return view(coll).byId.get(id); }

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Writes only the fields that differ. Returns the previous values of those fields, for undo. */
export function put<C extends CollName>(coll: C, id: string, patch: Partial<Collections[C]>, opts: { stamp?: string; local?: boolean } = {}): Partial<Collections[C]> {
  const c = data[coll] ?? {};
  const rec = c[id];
  const changed: Fields = {}, prev: Fields = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id" || v === undefined) continue;
    if (!rec || !(k in rec.f) || !same(rec.f[k], v)) { changed[k] = v; prev[k] = rec?.f[k]; }
  }
  if (!Object.keys(changed).length) return {};
  const stamp = opts.stamp ?? makeStamp(DEVICE);
  data = { ...data, [coll]: { ...c, [id]: setFields(rec, id, changed, stamp) } };
  emit([coll], opts.local !== false);
  return prev as Partial<Collections[C]>;
}

export function create<C extends CollName>(coll: C, obj: Collections[C]): Collections[C] {
  const { id, ...rest } = obj as { id: string };
  put(coll, id, rest as Partial<Collections[C]>);
  return obj;
}

export function remove(coll: CollName, id: string) { put(coll, id, { deleted: true } as never); }
export function restore(coll: CollName, id: string) { put(coll, id, { deleted: false } as never); }

export function settings(): Settings {
  const s = view("settings").byId.get("main");
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), id: "main", energy: { ...DEFAULT_SETTINGS.energy, ...(s?.energy ?? {}) } };
}
export function setSettings(p: Partial<Settings>) { put("settings", "main", p); }

// ── Sync hooks ─────────────────────────────────────────────────────────────
export function snapshot(): DataSet { return data; }
/** Merges data from another device. Doesn't count as a local change. */
export function applyRemote(incoming: DataSet): number {
  const r = mergeData(data, incoming);
  if (!r.changed.length) return 0;
  data = r.data;
  emit(new Set(r.changed.map(x => x.coll)), false);
  return r.changed.length;
}
export function replaceAll(next: DataSet) { data = next; emit(COLLECTIONS, true); }
export function onLocalChange(fn: () => void) { localChangeListeners.add(fn); return () => { localChangeListeners.delete(fn); }; }
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const version = () => globalVersion;

// ── React ──────────────────────────────────────────────────────────────────
export function useColl<C extends CollName>(coll: C): Collections[C][] {
  return useSyncExternalStore(subscribe, () => all(coll));
}
export function useRec<C extends CollName>(coll: C, id: string | null | undefined): Collections[C] | undefined {
  return useSyncExternalStore(subscribe, () => (id ? get(coll, id) : undefined));
}
let settingsCache: { v: number; s: Settings } | null = null;
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => {
    const v = versions.settings ?? 0;
    if (!settingsCache || settingsCache.v !== v) settingsCache = { v, s: settings() };
    return settingsCache.s;
  });
}
export function useVersion() { return useSyncExternalStore(subscribe, version); }

/** For tests: start from empty. */
export function _reset(d: DataSet = {}) { data = d; for (const k of Object.keys(versions)) versions[k]++; cache.clear(); settingsCache = null; }

/** Writes fields with a stamp from somewhere else (Google). Each field only changes if that stamp is newer than ours. */
export function putFrom<C extends CollName>(coll: C, id: string, patch: Partial<Collections[C]>, stamp: string): number {
  const f: Fields = {};
  for (const [k, v] of Object.entries(patch)) if (k !== "id" && v !== undefined) f[k] = v;
  return applyRemote({ [coll]: { [id]: setFields(undefined, id, f, stamp) } });
}
