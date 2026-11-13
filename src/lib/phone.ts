import { settings } from "./store";

// Silencing the phone during focus. A website can't switch Android's Do Not Disturb itself, so Cadence
// calls two links the person sets up in MacroDroid (a free Android automation app): one turns Do Not
// Disturb on, the other turns it off. Any device can call them, so starting focus on a PC silences the phone too.
// The "on" link gets ?minutes=N&until=<ISO time>, so a MacroDroid macro can also switch itself off on time.

const KEY = "cadence:phone:silenced";
const isOn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const mark = (v: boolean) => { try { if (v) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch {} };

function call(url: string, params: Record<string, string> = {}): Promise<boolean> {
  if (!/^https:\/\//i.test(url.trim())) return Promise.resolve(false);
  const u = new URL(url.trim());
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // no-cors: MacroDroid only needs to receive the request; Cadence doesn't need to read the reply.
  return fetch(u.toString(), { method: "GET", mode: "no-cors", cache: "no-store", keepalive: true }).then(() => true, () => false);
}

export function silencePhone(minutes: number) {
  const s = settings();
  if (!s.phoneSilence || !s.phoneOnUrl) return;
  mark(true);
  void call(s.phoneOnUrl, { minutes: String(Math.max(1, Math.round(minutes))), until: new Date(Date.now() + minutes * 60_000).toISOString(), source: "cadence" });
}

export function unsilencePhone(force = false) {
  const s = settings();
  if (!s.phoneOffUrl || (!force && !isOn())) return;
  mark(false);
  void call(s.phoneOffUrl, { source: "cadence" });
}

export const testPhone = (which: "on" | "off") => {
  const s = settings();
  return which === "on" ? call(s.phoneOnUrl, { minutes: "1", until: new Date(Date.now() + 60_000).toISOString(), source: "cadence-test" }) : call(s.phoneOffUrl, { source: "cadence-test" });
};

// ── End-of-round chime ────────────────────────────────────────────────────
let ctx: AudioContext | null = null;
/** Browsers only allow sound after a tap: call this from the Start button. */
export function primeSound() {
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") void ctx.resume(); } catch {}
}
export function chime(kind: "focus" | "break") {
  if (!settings().focusChime) return;
  try { navigator.vibrate?.(kind === "focus" ? [180, 120, 180, 120, 380] : [250, 150, 250]); } catch {}
  try {
    ctx ??= new AudioContext();
    const notes = kind === "focus" ? [659.25, 783.99, 1046.5] : [783.99, 659.25];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.22;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 1);
    });
  } catch {}
}
