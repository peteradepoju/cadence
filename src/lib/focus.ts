import { useSyncExternalStore } from "react";
import { uid } from "./model";
import { put, settings } from "./store";
import { chime, silencePhone, unsilencePhone } from "./phone";

// The focus timer. It keeps going while you move around the app (and across a reload), and each
// finished focus round is logged as time spent on its task.

export type Mode = "focus" | "break" | "long";
export interface FocusState { taskId: string | null; mode: Mode; running: boolean; endsAt: number | null; left: number; round: number; startedAt: number | null; total: number }

const KEY = "cadence:focus";
const initial = (): FocusState => ({ taskId: null, mode: "focus", running: false, endsAt: null, left: settings().focusMinutes * 60, round: 1, startedAt: null, total: settings().focusMinutes * 60 });
let s: FocusState = (() => { try { const x = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (x) return x; } catch {} return null as unknown as FocusState; })() ?? initial();
const subs = new Set<() => void>();
let onFinish: (mode: Mode, taskId: string | null) => void = () => {};
export function setFocusFinishHandler(f: typeof onFinish) { onFinish = f; }

function emit(next: Partial<FocusState>) {
  s = { ...s, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  subs.forEach(f => f());
}
export const useFocus = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => s);
export const focusState = () => s;

const lengthOf = (m: Mode) => { const st = settings(); return (m === "focus" ? st.focusMinutes : m === "break" ? st.breakMinutes : st.longBreakMinutes) * 60; };

export function start(taskId?: string | null) {
  const left = s.running ? s.left : (s.left > 0 ? s.left : lengthOf(s.mode));
  emit({ running: true, endsAt: Date.now() + left * 1000, left, startedAt: s.startedAt ?? Date.now(), ...(taskId !== undefined ? { taskId } : {}) });
  if (s.mode === "focus") silencePhone(left / 60);
}
export function pause() { if (!s.running) return; emit({ running: false, left: remaining(), endsAt: null }); unsilencePhone(); }
export function reset(mode: Mode = s.mode) { logPartial(); unsilencePhone(); const total = lengthOf(mode); emit({ running: false, endsAt: null, left: total, total, mode, startedAt: null }); }
export function setTask(taskId: string | null) { emit({ taskId }); }
export function remaining(): number { return s.running && s.endsAt ? Math.max(0, Math.round((s.endsAt - Date.now()) / 1000)) : s.left; }

/** Logs the minutes of a focus round that was stopped early (only if at least a minute). */
function logPartial() {
  if (s.mode !== "focus" || !s.startedAt) return;
  const spent = Math.floor((s.total - remaining()) / 60);
  if (spent >= 1) put("sessions", uid(), { taskId: s.taskId, start: new Date(s.startedAt).toISOString(), minutes: spent, kind: "focus", note: "" });
}

export function skip() {
  if (s.mode === "focus") logPartial();
  next(false);
}

function next(finished: boolean) {
  const st = settings();
  unsilencePhone();
  if (s.mode === "focus") {
    if (finished && s.startedAt) put("sessions", uid(), { taskId: s.taskId, start: new Date(s.startedAt).toISOString(), minutes: Math.round(s.total / 60), kind: "focus", note: "" });
    const mode: Mode = s.round % 4 === 0 ? "long" : "break";
    const total = (mode === "long" ? st.longBreakMinutes : st.breakMinutes) * 60;
    emit({ mode, running: finished, left: total, total, endsAt: finished ? Date.now() + total * 1000 : null, startedAt: finished ? Date.now() : null });
  } else {
    const total = st.focusMinutes * 60;
    emit({ mode: "focus", round: s.round + 1, running: false, left: total, total, endsAt: null, startedAt: null });
  }
}

setInterval(() => {
  if (!s.running) return;
  if (remaining() <= 0) {
    const m = s.mode, t = s.taskId;
    next(true);
    chime(m === "focus" ? "focus" : "break");
    onFinish(m, t);
  } else subs.forEach(f => f());
}, 1000);
