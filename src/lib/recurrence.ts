import { addDays, addMonths, dayOfWeek, DAY_SHORT, parseYmd, ymd, MONTH_SHORT } from "./dates";
import type { Rule } from "./model";

/** The nth weekday of a month ("2nd Tuesday"; week -1 is the last one). */
function nthWeekday(year: number, month: number, week: number, day: number): string {
  if (week === -1) {
    const last = new Date(year, month + 1, 0);
    const back = (last.getDay() - day + 7) % 7;
    last.setDate(last.getDate() - back);
    return ymd(last);
  }
  const first = new Date(year, month, 1);
  const offset = (day - first.getDay() + 7) % 7;
  const d = new Date(year, month, 1 + offset + (week - 1) * 7);
  if (d.getMonth() !== month) return nthWeekday(year, month, -1, day);
  return ymd(d);
}

/**
 * The next date after `from` that the rule lands on. `from` is the current due date
 * (or, for "from done" rules, the day it was done).
 */
export function nextDate(rule: Rule, from: string): string | null {
  const n = Math.max(1, rule.interval || 1);
  let next: string;
  switch (rule.freq) {
    case "daily": next = addDays(from, n); break;
    case "weekly": {
      const days = (rule.days?.length ? [...rule.days] : [dayOfWeek(from)]).sort();
      const dow = dayOfWeek(from);
      const later = days.find(d => d > dow);
      if (later !== undefined) next = addDays(from, later - dow);
      else next = addDays(from, 7 * (n - 1) + (7 - dow) + days[0]);
      break;
    }
    case "monthly": {
      if (rule.nth) {
        const d = parseYmd(from);
        let m = d.getMonth() + n, y = d.getFullYear();
        y += Math.floor(m / 12); m %= 12;
        next = nthWeekday(y, m, rule.nth.week, rule.nth.day);
      } else next = addMonths(from, n, rule.monthDay ?? parseYmd(from).getDate());
      break;
    }
    case "yearly": next = addMonths(from, 12 * n); break;
  }
  if (rule.until && next > rule.until) return null;
  return next;
}

/** All dates in [start, end] the rule lands on, beginning at `anchor` (the task's current due date). */
export function occurrences(rule: Rule, anchor: string, start: string, end: string, max = 400): string[] {
  const out: string[] = [];
  let d: string | null = anchor;
  let guard = 0;
  while (d && d <= end && guard++ < max) {
    if (d >= start) out.push(d);
    d = nextDate(rule, d);
  }
  return out;
}

const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];
export function describeRule(r: Rule): string {
  const n = r.interval > 1 ? r.interval : 0;
  let s: string;
  switch (r.freq) {
    case "daily": s = n ? `Every ${n} days` : "Every day"; break;
    case "weekly": {
      const days = r.days ?? [];
      const names = days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d)) ? "weekdays"
        : days.length === 2 && days.includes(0) && days.includes(6) ? "weekend"
        : days.map(d => DAY_SHORT[d]).join(", ");
      s = (n ? `Every ${n} weeks` : "Every week") + (names ? ` on ${names}` : "");
      if (!n && names === "weekdays") s = "Every weekday";
      break;
    }
    case "monthly":
      s = (n ? `Every ${n} months` : "Every month") + (r.nth ? ` on the ${r.nth.week === -1 ? "last" : ORD[r.nth.week]} ${DAY_SHORT[r.nth.day]}` : r.monthDay ? ` on the ${r.monthDay}${suffix(r.monthDay)}` : "");
      break;
    case "yearly": s = n ? `Every ${n} years` : "Every year"; break;
  }
  if (r.fromDone) s += ", after done";
  if (r.until) { const d = parseYmd(r.until); s += `, until ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`; }
  return s;
}
const suffix = (n: number) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

/** RRULE text for Google Calendar. */
export function toRRule(r: Rule): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  if (r.freq === "weekly" && r.days?.length) parts.push(`BYDAY=${r.days.map(d => codes[d]).join(",")}`);
  if (r.freq === "monthly" && r.nth) parts.push(`BYDAY=${r.nth.week}${codes[r.nth.day]}`);
  if (r.freq === "monthly" && !r.nth && r.monthDay) parts.push(`BYMONTHDAY=${r.monthDay > 28 ? -1 : r.monthDay}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, "")}T235959Z`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  return "RRULE:" + parts.join(";");
}

