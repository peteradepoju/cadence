import { dueMoment, today, toMin } from "./dates";
import { dueOn, logMap, countOn } from "./habits";
import { all, get, settings, subscribe } from "./store";

// Reminders while Cadence is open (or installed and running in the background on desktop).
// When it's closed, Google Calendar does the reminding (gcal.ts).

type Toast = (title: string, body: string, url?: string) => void;
let toast: Toast = () => {};
export function setToaster(t: Toast) { toast = t; }

const firedKey = "cadence:fired";
function fired(): Record<string, number> { try { return JSON.parse(localStorage.getItem(firedKey) ?? "{}"); } catch { return {}; } }
function markFired(k: string) {
  const f = fired(); f[k] = Date.now();
  for (const [key, at] of Object.entries(f)) if (Date.now() - at > 3 * 86400_000) delete f[key];
  try { localStorage.setItem(firedKey, JSON.stringify(f)); } catch {}
}

export const canNotify = () => typeof Notification !== "undefined";
export async function askPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return "denied";
  return Notification.permission === "default" ? Notification.requestPermission() : Notification.permission;
}

async function show(key: string, title: string, body: string, url: string) {
  if (fired()[key]) return;
  markFired(key);
  toast(title, body, url);
  if (!canNotify() || Notification.permission !== "granted" || document.visibilityState === "visible") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag: key, icon: import.meta.env.BASE_URL + "icon-192.png", badge: import.meta.env.BASE_URL + "icon-192.png", data: { url: import.meta.env.BASE_URL + url.replace(/^\//, "") } };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* some browsers refuse; the toast was shown */ }
}

interface Due { key: string; at: number; title: string; body: string; url: string }

export function upcoming(now = Date.now()): Due[] {
  const out: Due[] = [];
  const horizon = now + 36 * 3600_000;
  for (const t of all("tasks")) {
    if (t.done || !t.due) continue;
    for (const r of t.reminders) {
      const at = r.at ? Date.parse(r.at) : dueMoment(t.due, t.time).getTime() - (r.before ?? 0) * 60_000;
      if (at > now - 10 * 60_000 && at < horizon) out.push({ key: `t:${t.id}:${r.id}:${t.due}:${t.time}`, at, title: t.title, body: t.time ? `Due ${t.due === today() ? "today" : t.due} at ${t.time}` : `Due ${t.due === today() ? "today" : t.due}`, url: `/task/${t.id}` });
    }
  }
  const logs = logMap();
  const d = today();
  for (const h of all("habits")) {
    if (h.archived || !h.reminder || !dueOn(h, d) || countOn(logs, h, d) >= Math.max(1, h.target)) continue;
    const at = new Date(); const m = toMin(h.reminder); at.setHours(Math.floor(m / 60), m % 60, 0, 0);
    out.push({ key: `h:${h.id}:${d}`, at: at.getTime(), title: `${h.emoji} ${h.name}`.trim(), body: "Time for your habit.", url: "/habits" });
  }
  const s = settings();
  if (s.reviewTime && !get("reviews", `day:${d}`)?.doneAt) {
    const at = new Date(); const m = toMin(s.reviewTime); at.setHours(Math.floor(m / 60), m % 60, 0, 0);
    out.push({ key: `review:${d}`, at: at.getTime(), title: "End of the day", body: "Two minutes to close the day and carry the rest forward.", url: "/review" });
  }
  return out.sort((a, b) => a.at - b.at);
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule() {
  if (timer) clearTimeout(timer);
  const now = Date.now();
  const list = upcoming(now);
  const f = fired();
  for (const u of list) if (u.at <= now && !f[u.key] && now - u.at < 10 * 60_000) void show(u.key, u.title, u.body, u.url);
  const next = list.find(u => u.at > now);
  const wait = next ? Math.min(next.at - now + 200, 15 * 60_000) : 15 * 60_000;
  timer = setTimeout(schedule, Math.max(1000, wait));
}

let started = false;
export function startReminders() {
  if (started) return;
  started = true;
  let pending: ReturnType<typeof setTimeout> | null = null;
  subscribe(() => { if (pending) clearTimeout(pending); pending = setTimeout(schedule, 500); });
  document.addEventListener("visibilitychange", schedule);
  schedule();
}

