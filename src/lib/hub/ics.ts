// Just enough iCalendar (RFC 5545) to read a published study calendar: unfold the lines, take the
// VEVENTs, and turn the few properties that matter into plain objects. No library, because a feed
// is a handful of fields and Cadence ships what it needs.

export interface IcsEvent {
  uid: string;
  start: string;        // YYYY-MM-DD (all-day) or the date part of a timed event
  time: string | null;  // HH:MM when the event has one
  allDay: boolean;
  summary: string;
  description: string;
  url: string | null;
}

/** Joins the continuation lines a feed wraps at 75 octets back onto their property. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** "\n", "\," and "\;" are escaped in iCalendar text values. */
const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** "20261116" or "20261116T093000Z" → a local calendar day, plus the time when there is one. */
function readDate(raw: string, params: string): { date: string; time: string | null; allDay: boolean } | null {
  const v = raw.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  if (!hh || /VALUE=DATE(?!-TIME)/i.test(params)) return { date: `${y}-${mo}-${d}`, time: null, allDay: true };
  if (z) {
    // A UTC stamp has to become the viewer's own day, or an evening event lands on the wrong date.
    const local = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm));
    const p = (n: number) => String(n).padStart(2, "0");
    return { date: `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`, time: `${p(local.getHours())}:${p(local.getMinutes())}`, allDay: false };
  }
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}`, allDay: false };
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;

  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur?.start && (cur.summary || cur.uid)) {
        events.push({
          uid: cur.uid || `${cur.start}:${cur.summary}`,
          start: cur.start,
          time: cur.time ?? null,
          allDay: cur.allDay ?? true,
          summary: cur.summary ?? "",
          description: cur.description ?? "",
          url: cur.url ?? null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon), value = line.slice(colon + 1);
    const name = left.split(";")[0].toUpperCase();
    const params = left.slice(name.length);

    if (name === "UID") cur.uid = value.trim();
    else if (name === "SUMMARY") cur.summary = unescape(value).trim();
    else if (name === "DESCRIPTION") cur.description = unescape(value).trim();
    else if (name === "URL") cur.url = value.trim();
    else if (name === "DTSTART") {
      const d = readDate(value, params);
      if (d) { cur.start = d.date; cur.time = d.time; cur.allDay = d.allDay; }
    }
  }
  return events;
}
