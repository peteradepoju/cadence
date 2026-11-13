import { addDays, addMonths, dayOfWeek, pad, today as todayFn } from "./dates";
import type { Priority, Rule } from "./model";

// Quick capture without AI: "call mum fri 6pm #family !1 every week /Home for 30m".
//   #tag  ·  /Project  ·  !1–!4 or p1–p4  ·  dates and times  ·  "every …"  ·  "for 30m"
// Works offline and instantly. With AI on, Gemini can also read looser sentences (ai.ts).

export interface Parsed {
  title: string;
  due: string | null;
  time: string | null;
  priority: Priority | null;
  tags: string[];
  project: string | null;   // matched project name
  recurrence: Rule | null;
  duration: number | null;
  /** The pieces that were understood, to show as chips while typing. */
  found: { kind: "date" | "time" | "tag" | "project" | "priority" | "repeat" | "duration"; text: string }[];
}

const DAYS: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const DAY_RE = "(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)";
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const dayNum = (s: string) => DAYS[s.toLowerCase()];

function nextDow(from: string, dow: number, skipToday = false): string {
  const cur = dayOfWeek(from);
  let diff = (dow - cur + 7) % 7;
  if (diff === 0 && skipToday) diff = 7;
  return addDays(from, diff);
}

function to24(h: number, m: number, ap?: string): string | null {
  if (ap) {
    const a = ap.toLowerCase();
    if (h < 1 || h > 12) return null;
    if (a.startsWith("p") && h !== 12) h += 12;
    if (a.startsWith("a") && h === 12) h = 0;
  }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function parseCapture(input: string, opts: { projects?: string[]; today?: string } = {}): Parsed {
  const today = opts.today ?? todayFn();
  let s = " " + input.replace(/\s+/g, " ") + " ";
  const found: Parsed["found"] = [];
  const out: Parsed = { title: "", due: null, time: null, priority: null, tags: [], project: null, recurrence: null, duration: null, found };

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = s.match(re);
    if (!m || m.index === undefined) return false;
    if (fn(m) === false) return false;
    s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    return true;
  };

  // Tags
  for (let i = 0; i < 20 && take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, m => { out.tags.push(m[1].toLowerCase()); found.push({ kind: "tag", text: "#" + m[1] }); }); i++);

  // Project: "/Name" matched against known projects (longest first, may contain spaces)
  const projects = [...(opts.projects ?? [])].sort((a, b) => b.length - a.length);
  take(/\s\/([^\s/][^/]*?)(?=\s|$)/u, m => {
    const rest = (m[1] + s.slice((m.index ?? 0) + m[0].length)).toLowerCase();
    const hit = projects.find(p => rest.startsWith(p.toLowerCase()) && /^(\s|$)/.test(rest.slice(p.length)));
    if (hit) {
      // swallow the whole project name (it may continue past the first word)
      const start = m.index ?? 0;
      s = s.slice(0, start) + " " + s.slice(start + 2 + hit.length);
      out.project = hit; found.push({ kind: "project", text: "/" + hit });
      return false; // already sliced
    }
    out.project = m[1]; found.push({ kind: "project", text: "/" + m[1] });
  });

  // Priority
  take(/\s(?:!([1-4])|p([1-4]))(?=\s)/i, m => { out.priority = Number(m[1] ?? m[2]) as Priority; found.push({ kind: "priority", text: m[0].trim() }); });
  if (!out.priority) take(/\s(!!!|urgent!?|asap)(?=\s)/i, m => { out.priority = 1; found.push({ kind: "priority", text: m[1] }); });

  // Duration: "for 30m", "for 1h30", "for 1.5 hours", "45min"
  take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)(?:\s*(\d+)\s*(?:m|min|mins)?)?(?=\s)/i, m => {
    if (!/for/i.test(m[0]) && !/h/i.test(m[2])) return false;
    out.duration = Math.round(parseFloat(m[1]) * 60 + (m[3] ? Number(m[3]) : 0));
    found.push({ kind: "duration", text: m[0].trim() });
  }) || take(/\s(?:for\s+)?(\d+)\s*(m|min|mins|minutes)(?=\s)/i, m => { out.duration = Number(m[1]); found.push({ kind: "duration", text: m[0].trim() }); });

  // Repeats
  const rep = (r: Rule, text: string) => { out.recurrence = r; found.push({ kind: "repeat", text: text.trim() }); };
  take(/\s(every\s+weekday|weekdays)(?=\s)/i, m => rep({ freq: "weekly", interval: 1, days: [1, 2, 3, 4, 5] }, m[0])) ||
  take(/\s(every\s+weekend|weekends)(?=\s)/i, m => rep({ freq: "weekly", interval: 1, days: [0, 6] }, m[0])) ||
  take(new RegExp(`\\severy\\s+(other\\s+)?${DAY_RE}((?:\\s*(?:,|and|&)\\s*${DAY_RE})*)(?=\\s)`, "i"), m => {
    const days = [m[2], ...(m[3] ? m[3].split(/\s*(?:,|and|&)\s*/i).filter(Boolean) : [])].map(dayNum).filter(d => d !== undefined);
    rep({ freq: "weekly", interval: m[1] ? 2 : 1, days: [...new Set(days)].sort() }, m[0]);
    if (!out.due) out.due = nextDow(today, Math.min(...days.map(d => (d - dayOfWeek(today) + 7) % 7)) + dayOfWeek(today));
  }) ||
  take(/\severy\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, m => {
    const md = Math.min(31, Number(m[1]));
    rep({ freq: "monthly", interval: 1, monthDay: md }, m[0]);
    const thisMonth = today.slice(0, 8) + pad(md);
    out.due = thisMonth >= today ? addMonths(today.slice(0, 8) + "01", 0, md) : addMonths(today.slice(0, 8) + "01", 1, md);
  }) ||
  take(/\s(?:every\s+(\d+|other)\s+(day|week|month|year)s?|every\s+(day|week|month|year)|(daily|weekly|monthly|yearly|annually))(?:\s+after\s+(?:done|completion))?(?=\s)/i, m => {
    const unit = (m[2] ?? m[3] ?? { daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year" }[m[4].toLowerCase()]).toLowerCase();
    const interval = m[1] ? (m[1].toLowerCase() === "other" ? 2 : Number(m[1])) : 1;
    const freq = ({ day: "daily", week: "weekly", month: "monthly", year: "yearly" } as const)[unit as "day"];
    rep({ freq, interval, ...(/after/i.test(m[0]) ? { fromDone: true } : {}) }, m[0]);
  });

  // Times
  const setTime = (t: string | null, text: string) => { if (!t) return false; out.time = t; found.push({ kind: "time", text: text.trim() }); };
  take(/\s(?:at\s+|@)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s)/i, m => setTime(to24(Number(m[1]), Number(m[2] ?? 0), m[3]), m[0])) ||
  take(/\s(?:at\s+|@)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/i, m => setTime(to24(Number(m[1]), Number(m[2])), m[0])) ||
  take(/\sat\s+(\d{1,2})(?=\s)/i, m => { const h = Number(m[1]); return setTime(to24(h >= 1 && h <= 7 ? h + 12 : h, 0), m[0]); }) ||
  take(/\s(?:at\s+)?(noon|midday|midnight)(?=\s)/i, m => setTime(/mid(?!day)/i.test(m[1]) && /night/i.test(m[1]) ? "23:59" : "12:00", m[0]));

  // Dates
  const setDate = (d: string, text: string) => { out.due = d; found.push({ kind: "date", text: text.trim() }); };
  take(/\s(today|tod)(?=\s)/i, m => setDate(today, m[0])) ||
  take(/\s(tonight)(?=\s)/i, m => { setDate(today, m[0]); if (!out.time) out.time = "20:00"; }) ||
  take(/\s(tomorrow|tmrw?|tmw)(?:\s+(morning|afternoon|evening|night))?(?=\s)/i, m => { setDate(addDays(today, 1), m[0]); if (m[2] && !out.time) out.time = partOfDay(m[2]); }) ||
  take(/\s(day after tomorrow)(?=\s)/i, m => setDate(addDays(today, 2), m[0])) ||
  take(/\sin\s+(\d+|a|an|one|two|three)\s+(day|week|month|year)s?(?=\s)/i, m => {
    const n = ({ a: 1, an: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[m[1].toLowerCase()] ?? Number(m[1]);
    const u = m[2].toLowerCase();
    setDate(u === "day" ? addDays(today, n) : u === "week" ? addDays(today, 7 * n) : u === "month" ? addMonths(today, n) : addMonths(today, 12 * n), m[0]);
  }) ||
  take(/\s(next\s+week)(?=\s)/i, m => setDate(nextDow(today, 1, true), m[0])) ||
  take(/\s(next\s+month)(?=\s)/i, m => setDate(addMonths(today.slice(0, 8) + "01", 1), m[0])) ||
  take(/\s(this\s+weekend|weekend)(?=\s)/i, m => setDate(nextDow(today, 6), m[0])) ||
  take(/\s(end\s+of\s+(?:the\s+)?week|eow)(?=\s)/i, m => setDate(nextDow(today, 5), m[0])) ||
  take(/\s(end\s+of\s+(?:the\s+)?month|eom)(?=\s)/i, m => setDate(addDays(addMonths(today.slice(0, 8) + "01", 1), -1), m[0])) ||
  take(new RegExp(`\\s(?:on\\s+)?(next\\s+|this\\s+)?${DAY_RE}(?:\\s+(morning|afternoon|evening|night))?(?=\\s)`, "i"), m => {
    const d = dayNum(m[2]);
    let date = nextDow(today, d, !!m[1] && /next/i.test(m[1]));
    if (m[1] && /next/i.test(m[1]) && date === nextDow(today, d)) date = date === today ? addDays(today, 7) : date;
    setDate(date, m[0]);
    if (m[3] && !out.time) out.time = partOfDay(m[3]);
  }) ||
  take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?(?=\\s)`, "i"), m => setDate(fullDate(today, Number(m[1]), MONTHS[m[2].toLowerCase()], m[3]), m[0])) ||
  take(new RegExp(`\\s(?:on\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=\\s)`, "i"), m => setDate(fullDate(today, Number(m[2]), MONTHS[m[1].toLowerCase()], m[3]), m[0])) ||
  take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, m => setDate(`${m[1]}-${m[2]}-${m[3]}`, m[0])) ||
  take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, m => setDate(fullDate(today, Number(m[1]), Number(m[2]), m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : undefined), m[0])) ||
  take(/\son\s+the\s+(\d{1,2})(?:st|nd|rd|th)(?=\s)/i, m => {
    const day = Number(m[1]);
    let d = today.slice(0, 8) + pad(day);
    if (d < today) d = addMonths(today.slice(0, 8) + "01", 1, day);
    setDate(d, m[0]);
  });

  // Parts of the day on their own: "call mum evening"
  if (!out.time) take(/\s(?:this\s+|in\s+the\s+)?(morning|afternoon|evening)(?=\s)/i, m => { setTime(partOfDay(m[1]), m[0]); if (!out.due) out.due = today; });

  // A time with no date means today (or tomorrow if that time has passed)
  if (out.time && !out.due) {
    const now = new Date();
    out.due = `${pad(now.getHours())}:${pad(now.getMinutes())}` > out.time ? addDays(today, 1) : today;
    found.push({ kind: "date", text: out.due === today ? "today" : "tomorrow" });
  }
  // A repeat with no date starts today
  if (out.recurrence && !out.due) out.due = today;

  out.title = s.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim().replace(/^(on|at|by)\s+/i, "").replace(/\s+(on|at|by|for)$/i, "");
  if (!out.title) out.title = input.trim();
  return out;
}

function partOfDay(p: string): string {
  const x = p.toLowerCase();
  return x === "morning" ? "09:00" : x === "afternoon" ? "14:00" : x === "evening" ? "18:00" : "20:00";
}

function fullDate(today: string, day: number, month: number, year?: string): string {
  let y = year ? Number(year) : Number(today.slice(0, 4));
  let d = `${y}-${pad(month)}-${pad(day)}`;
  if (!year && d < today) { y++; d = `${y}-${pad(month)}-${pad(day)}`; }
  return d;
}
