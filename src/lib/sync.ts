import { useSyncExternalStore } from "react";
import { type DataSet, slimTombstones } from "./crdt";
import { createFile, download, ensureFolder, findFiles, trashFile, updateFile } from "./drive";
import { syncCalendar } from "./gcal";
import { AuthNeeded, googleState, hasScope, hasToken, isConnected, resumeOnNextTap } from "./google";
import { syncGoogleTasks } from "./gtasks";
import { idb } from "./idb";
import { all, applyRemote, DEVICE, flush, onLocalChange, put, settings, snapshot } from "./store";

// Drive sync. Each device keeps its own file in Cadence/sync/ ("device-<id>.json") with everything it
// knows, and reads the other devices' files. Only one device ever writes a given file, so two devices
// can't overwrite each other; merging is field by field (crdt.ts), so no edit is lost.
// Files of devices not seen for 60 days are removed once their contents are in this device's file.

export type SyncStatus = "off" | "syncing" | "synced" | "paused" | "offline" | "error";
interface SyncState { status: SyncStatus; at: number | null; error: string | null; folder: string | null; detail: string }
let st: SyncState = { status: "off", at: null, error: null, folder: null, detail: "" };
const subs = new Set<() => void>();
const set = (p: Partial<SyncState>) => { st = { ...st, ...p }; subs.forEach(f => f()); };
export const useSync = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => st);
export const syncState = () => st;

interface Meta { account: string; root?: string; syncDir?: string; files?: string; mine?: string; seen: Record<string, string>; uploadedAt?: number }
const metaKey = "cadence:sync:meta";
function loadMeta(): Meta {
  const email = googleState().account?.email ?? "";
  try { const m = JSON.parse(localStorage.getItem(metaKey) ?? "null") as Meta | null; if (m && m.account === email) return m; } catch {}
  return { account: email, seen: {} };
}
const saveMeta = (m: Meta) => { try { localStorage.setItem(metaKey, JSON.stringify(m)); } catch {} };
export function forgetSyncMeta() { try { localStorage.removeItem(metaKey); } catch {} }

let dirty = (() => { try { return localStorage.getItem("cadence:sync:dirty") !== "0"; } catch { return true; } })();
const setDirty = (v: boolean) => { dirty = v; try { localStorage.setItem("cadence:sync:dirty", v ? "1" : "0"); } catch {} };

const STALE_MS = 60 * 86400_000;

async function driveSync() {
  const m = loadMeta();
  if (!m.root) m.root = await ensureFolder("Cadence", null, "root");
  if (!m.syncDir) m.syncDir = await ensureFolder("sync", m.root, "sync");
  if (!m.files) m.files = await ensureFolder("Attachments", m.root, "files");
  set({ folder: m.root });
  const files = await findFiles(`'${m.syncDir}' in parents and trashed=false`);
  const myName = `device-${DEVICE}.json`;
  const mine = files.find(f => f.name === myName);
  if (mine) m.mine = mine.id; else m.mine = undefined;

  let pulled = 0;
  for (const f of files) {
    if (f.name === myName || !f.name.startsWith("device-")) continue;
    if (m.seen[f.id] === f.modifiedTime) continue;
    try {
      const j = (await (await download(f.id)).json()) as { data?: DataSet };
      if (j?.data) pulled += applyRemote(j.data);
      m.seen[f.id] = f.modifiedTime;
    } catch (e) { if (e instanceof AuthNeeded) throw e; /* a broken file shouldn't stop the rest */ }
  }
  // Forget files that are gone.
  for (const id of Object.keys(m.seen)) if (!files.some(f => f.id === id)) delete m.seen[id];

  const needUpload = dirty || !m.mine || pulled > 0 && (!m.uploadedAt || Date.now() - m.uploadedAt > 86400_000);
  if (needUpload) {
    const v = localVersion;
    const body = new Blob([JSON.stringify({ app: "cadence", v: 1, device: DEVICE, at: new Date().toISOString(), data: slimTombstones(snapshot(), 30 * 86400_000) })], { type: "application/json" });
    if (m.mine) await updateFile(m.mine, body);
    else m.mine = (await createFile(myName, m.syncDir, body, { cadence: "device", device: DEVICE })).id;
    m.uploadedAt = Date.now();
    if (v === localVersion) setDirty(false);
    // This device's file now holds everything, so long-unused devices' files can go.
    for (const f of files) {
      if (f.id === m.mine || !f.name.startsWith("device-")) continue;
      if (Date.now() - Date.parse(f.modifiedTime) > STALE_MS && m.seen[f.id] === f.modifiedTime) {
        await trashFile(f.id).catch(() => {});
        delete m.seen[f.id];
      }
    }
  }
  saveMeta(m);
  await syncFiles(m.files);
}

/** Uploads attachments added on this device; their content stays on the device too, for offline use. */
async function syncFiles(folder: string) {
  for (const f of all("files")) {
    if (f.driveId) continue;
    const blob = await idb.getBlob(`file:${f.id}`).catch(() => undefined);
    if (!blob) continue;
    const made = await createFile(f.name, folder, blob, { cadence: "file", fileId: f.id });
    put("files", f.id, { driveId: made.id });
  }
}

/** The attachment's content, from the device or from Drive. */
export async function fileBlob(id: string): Promise<Blob | null> {
  const local = await idb.getBlob(`file:${id}`).catch(() => undefined);
  if (local) return local;
  const meta = all("files").find(f => f.id === id);
  if (!meta?.driveId || !hasToken()) return null;
  const b = await (await download(meta.driveId)).blob();
  await idb.setBlob(`file:${id}`, b).catch(() => {});
  return b;
}

let localVersion = 0;
// Every local edit marks this device's Drive file as out of date.
onLocalChange(() => { localVersion++; setDirty(true); });
let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

async function runOnce() {
  if (!isConnected()) { set({ status: "off" }); return; }
  if (!navigator.onLine) { set({ status: "offline" }); return; }
  if (!hasToken()) { set({ status: "paused" }); if (autoResume()) resumeOnNextTap(() => void syncNow()); return; }
  set({ status: "syncing", error: null });
  try {
    await flush();
    set({ detail: "Drive" });
    await driveSync();
    const s = settings();
    if (s.gtasksOn && hasScope("tasks")) { set({ detail: "Google Tasks" }); await syncGoogleTasks(); }
    if (s.calOn && hasScope("calendar")) { set({ detail: "Google Calendar" }); await syncCalendar(); }
    // Google Tasks or Calendar may have changed things: send them to Drive now rather than next time.
    if (dirty) { set({ detail: "Drive" }); await driveSync(); }
    set({ status: "synced", at: Date.now(), detail: "" });
  } catch (e) {
    if (e instanceof AuthNeeded) { set({ status: "paused", detail: "" }); if (autoResume()) resumeOnNextTap(() => void syncNow()); return; }
    if (!navigator.onLine) { set({ status: "offline", detail: "" }); return; }
    console.error(e);
    set({ status: "error", error: (e as Error).message?.slice(0, 300) ?? "Sync failed", detail: "" });
  }
}

export const autoResume = () => { try { return localStorage.getItem("cadence:autoResume") !== "0"; } catch { return true; } };
export const setAutoResume = (v: boolean) => { try { localStorage.setItem("cadence:autoResume", v ? "1" : "0"); } catch {} };

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  onLocalChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 2500);
  });
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => set({ status: "offline" }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, 60_000);
  void syncNow();
}
