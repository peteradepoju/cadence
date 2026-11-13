// Dates are kept as local calendar days ("YYYY-MM-DD") and times as "HH:MM", so a task due on
// Friday stays on Friday whatever time zone the device moves to.

export const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export function parseYmd(s: string): Date { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(s: string, n: number): string { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
export function addMonths(s: string, n: number, keepDay?: number): string {
  const d = parseYmd(s);
  const day = keepDay ?? d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return ymd(target);
}
export const dayOfWeek = (s: string) => parseYmd(s).getDay();
export const diffDays = (a: string, b: string) => Math.round((parseYmd(a).getTime() - parseYmd(b).getTime()) / 86400000);
export function startOfWeek(s: string, weekStart: 0 | 1 = 1): string { const dow = dayOfWeek(s); return addDays(s, -((dow - weekStart + 7) % 7)); }
export const startOfMonth = (s: string) => s.slice(0, 8) + "01";
export function daysInMonth(s: string) { const d = parseYmd(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

export function isoWeek(s: string): { year: number; week: number } {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7) };
}
export const weekKey = (s: string) => { const w = isoWeek(s); return `${w.year}-W${pad(w.week)}`; };
/** Monday of an ISO week key. */
export function weekStartOf(key: string): string {
  const [y, w] = key.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  const mon = new Date(jan4); mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return ymd(mon);
}
export const quarterKey = (s: string) => `${s.slice(0, 4)}-Q${Math.floor((Number(s.slice(5, 7)) - 1) / 3) + 1}`;
export const monthKey = (s: string) => s.slice(0, 7);

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function niceDate(s: string, ref = today()): string {
  const d = diffDays(s, ref);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  const dt = parseYmd(s);
  if (d > 1 && d < 7) return DAY_LONG[dt.getDay()];
  const sameYear = s.slice(0, 4) === ref.slice(0, 4);
  return `${DAY_SHORT[dt.getDay()]} ${dt.getDate()} ${MONTH_SHORT[dt.getMonth()]}${sameYear ? "" : " " + dt.getFullYear()}`;
}
export function longDate(s: string): string { const d = parseYmd(s); return `${DAY_LONG[d.getDay()]}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`; }

export function niceTime(t: string, h24 = false): string {
  const [h, m] = t.split(":").map(Number);
  if (h24) return t;
  const ap = h < 12 ? "am" : "pm";
  const hh = h % 12 || 12;
  return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`;
}
export const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fromMin = (n: number) => `${pad(Math.floor(((n % 1440) + 1440) % 1440 / 60))}:${pad(((n % 60) + 60) % 60)}`;
export const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** The moment a task is due, as a Date in the device's time zone. Tasks without a time count as 09:00. */
export function dueMoment(due: string, time: string | null): Date {
  const d = parseYmd(due);
  const [h, m] = (time ?? "09:00").split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
export function minutesLabel(n: number): string {
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
