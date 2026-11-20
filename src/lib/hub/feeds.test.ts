import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics";
import { rowsToItems, selahSource } from "./feeds";
import { engramSource, euroniaSource, engramPosition, engramDateOf } from "./engram";

// The fixture mirrors the shapes Engram's published calendar really uses: folded SUMMARY lines,
// escaped commas, all-day VALUE=DATE events, lesson days, a weekly papers event and a rest week.
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Engram//NeuroAI course//EN",
  "X-WR-CALNAME:Engram study plan",
  "BEGIN:VEVENT",
  "UID:engram-1-1-2026-11-16@engram",
  "DTSTART;VALUE=DATE:20261123",
  "DTEND;VALUE=DATE:20261124",
  "SUMMARY:Engram W1 D1: Two kinds of intelligence: what NeuroAI is and w",
  " hy it matters",
  "DESCRIPTION:3 hours: lesson\\, paper\\, review and journal.\\nhttps://engram-neuroai.vercel.app/learn/w001/d1",
  "URL:https://engram-neuroai.vercel.app/learn/w001/d1",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:engram-papers-1@engram",
  "DTSTART;VALUE=DATE:20261124",
  "SUMMARY:Engram papers for week 1",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:engram-rest-1@engram",
  "DTSTART;VALUE=DATE:20261125",
  "SUMMARY:Engram rest week 1",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:timed@engram",
  "DTSTART:20261126T140000Z",
  "SUMMARY:A timed one",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("reading an iCalendar feed", () => {
  const events = parseIcs(ICS);

  it("finds every event and rejoins folded lines", () => {
    expect(events.length).toBe(4);
    expect(events[0].summary).toBe("Engram W1 D1: Two kinds of intelligence: what NeuroAI is and why it matters");
  });

  it("unescapes commas and newlines in the description", () => {
    expect(events[0].description.split("\n")[0]).toBe("3 hours: lesson, paper, review and journal.");
  });

  it("reads all-day and timed events", () => {
    expect(events[0].start).toBe("2026-11-23");
    expect(events[0].allDay).toBe(true);
    expect(events[0].time).toBeNull();
    expect(events[3].allDay).toBe(false);
    expect(events[3].time).toMatch(/^\d\d:\d\d$/);
  });

  it("keeps the deep link and the uid", () => {
    expect(events[0].url).toBe("https://engram-neuroai.vercel.app/learn/w001/d1");
    expect(events[0].uid).toBe("engram-1-1-2026-11-16@engram");
  });

  it("survives rubbish without throwing", () => {
    expect(parseIcs("")).toEqual([]);
    expect(parseIcs("BEGIN:VEVENT\nSUMMARY:no date\nEND:VEVENT")).toEqual([]);
    expect(parseIcs("not a calendar at all")).toEqual([]);
  });
});

const COURSE = {
  version: "v1",
  weeks: [
    { n: 1, kind: "teach", title: "What NeuroAI is, how researchers work, and your toolkit" },
    { n: 2, kind: "teach", title: "Arrays and the shape of neural data" },
    { n: 3, kind: "rest", title: "Rest week" },
  ],
  papers: [
    { id: "hassabis-2017", week: 1, day: 1, title: "Neuroscience-Inspired Artificial Intelligence", authors: "Hassabis et al.", year: 2017, deepRead: true, why: "The clearest map of the field." },
    { id: "other-2019", week: 1, day: 2, title: "A second paper", year: 2019 },
  ],
};

/** Stands in for the network: the version endpoint, then the course itself. */
function serving(course: unknown = COURSE) {
  return async (url: string) => url.endsWith("/version") ? JSON.stringify({ version: (course as { version: string }).version }) : JSON.stringify(course);
}

describe("Engram's own course becomes hub items", () => {
  const START = "2026-11-16"; // a Monday: week 1 day 1

  it("puts week 1 day 1 on the day you started, and rests on the seventh day", () => {
    expect(engramPosition(START, START)).toEqual({ week: 1, day: 1 });
    expect(engramPosition(START, "2026-11-21")).toEqual({ week: 1, day: 6 });
    expect(engramPosition(START, "2026-11-22")).toBeNull(); // day 7
    expect(engramPosition(START, "2026-11-23")).toEqual({ week: 2, day: 1 });
    expect(engramPosition(START, "2026-11-15")).toBeNull(); // before you began
    expect(engramDateOf(START, 2, 1)).toBe("2026-11-23");
  });

  it("reads the course, names the week, and links the exact day", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(await serving()(String(u)), { status: 200 })) as unknown as typeof fetch;
    try {
      const items = await engramSource.items({ from: START, to: "2026-11-21", config: { startedAt: START } });
      expect(items.length).toBe(6); // six study days
      expect(items[0].title).toContain("W1 D1");
      expect(items[0].title).toContain("What NeuroAI is");
      expect(items[0].url).toBe("https://engram-neuroai.vercel.app/learn/w001/d1");
      expect(items[0].externalId).toBe("w1d1");
      expect(items[0].duration).toBe(180);
    } finally { globalThis.fetch = original; }
  });

  it("skips a rest week entirely", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(await serving()(String(u)), { status: 200 })) as unknown as typeof fetch;
    try {
      // Week 3 starts 14 days after the start date and is a rest week.
      const items = await engramSource.items({ from: "2026-11-30", to: "2026-12-05", config: { startedAt: START } });
      expect(items).toEqual([]);
    } finally { globalThis.fetch = original; }
  });

  it("says nothing until you give it a start date", async () => {
    expect(engramSource.problem({})).toMatch(/started/);
    await expect(engramSource.items({ from: START, to: START, config: {} })).resolves.toEqual([]);
  });
});

describe("Euronia's paper of the day", () => {
  const START = "2026-11-16";
  it("names the real paper, gates the lab on it, and gives a deep read longer", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(await serving()(String(u)), { status: 200 })) as unknown as typeof fetch;
    try {
      const items = await euroniaSource.items({ from: START, to: "2026-11-17", config: { startedAt: START, minutes: 40 } });
      expect(items.length).toBe(2);
      expect(items[0].title).toContain("Neuroscience-Inspired");
      expect(items[0].externalId).toBe("hassabis-2017");
      expect(items[0].notes).toContain("Hassabis");
      expect(items[0].gate).toBe(true);
      expect(items[0].streak).toBe(true);
      expect(items[0].duration).toBe(60); // a deep read gets half as long again
      expect(items[1].duration).toBe(40);
    } finally { globalThis.fetch = original; }
  });

  it("offers nothing on a day with no paper", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(await serving()(String(u)), { status: 200 })) as unknown as typeof fetch;
    try {
      const items = await euroniaSource.items({ from: "2026-11-18", to: "2026-11-21", config: { startedAt: START } });
      expect(items).toEqual([]);
    } finally { globalThis.fetch = original; }
  });
});

describe("the open feed format any app can serve", () => {
  const from = "2026-11-23", to = "2026-11-30";

  it("takes a bare list or an items object", () => {
    const row = [{ id: "a", title: "Pay the tailor", due: "2026-11-28", minutes: 20 }];
    expect(rowsToItems("selah", row, "Selah", from, to).length).toBe(1);
    expect(rowsToItems("selah", { items: row }, "Selah", from, to).length).toBe(1);
  });

  it("carries the fields the planner needs, and fills sensible defaults", () => {
    const [i] = rowsToItems("selah", [{ id: "l7", title: "Loan repayment", due: "2026-11-28", minutes: 15, dayLock: 6, priority: 1, url: "https://x.test/l7", tags: ["money"], kind: "payment" }], "Selah", from, to);
    expect(i).toMatchObject({ sourceId: "selah", externalId: "l7", dayLock: 6, priority: 1, kind: "payment", duration: 15, project: "Selah" });

    const [j] = rowsToItems("selah", [{ id: "x", title: "Bare" }], "Selah", from, to);
    expect(j).toMatchObject({ priority: 3, duration: null, dayLock: null, streak: false, kind: "deadline", project: "Selah" });
  });

  it("ignores rubbish rows rather than failing the whole pull", () => {
    const items = rowsToItems("selah", [{ title: "" }, { id: "ok", title: "Real" }, { id: "bad", title: "Out", due: "2027-01-01" }, { id: "p", title: "Odd", priority: 9, dayLock: 44 }], "Selah", from, to);
    expect(items.map(i => i.externalId)).toEqual(["ok", "p"]);
    expect(items[1].priority).toBe(3);
    expect(items[1].dayLock).toBeNull();
  });

  it("marks work already finished over there so it is never offered", () => {
    const [i] = rowsToItems("selah", [{ id: "d", title: "Done there", done: true }], "Selah", from, to);
    expect(i.doneOutside).toBe(true);
  });

  it("refuses a document that isn't a list", () => {
    expect(() => rowsToItems("selah", { nope: 1 }, "Selah", from, to)).toThrow(/list of items/);
  });

  it("says what is missing before it is set up", () => {
    expect(selahSource.problem({})).toMatch(/Cadence feed/);
    expect(selahSource.problem({ url: "not-a-url" })).toMatch(/web address/);
    expect(selahSource.problem({ url: "https://x.test/feed" })).toBeNull();
  });
});
