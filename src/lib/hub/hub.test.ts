import { beforeEach, describe, expect, it } from "vitest";
import { alignedAnchor, curriculumById, positionOn, slotFor } from "./curricula";
import { describeDay, planById, planDay, plans } from "./bible";
import { ALL_CHAPTERS } from "./books";
import { accept, configFor, dailyBudget, dayCapacity, nextSlot, propose, pull, setConfig, waiting } from "./hub";
import { SOURCES, sourceById } from "./sources";
import { _reset, all, get, settings } from "../store";
import { addTask } from "../actions";
import { dayOfWeek } from "../dates";

// Dates used below: 2026-11-23 is a Monday, so 28th is a Saturday and 29th a Sunday.
const MON = "2026-11-23", SAT = "2026-11-28", SUN = "2026-11-29", THU = "2026-11-26";
// Starting a day-bound course on Thursday the 26th means its day 1 is Monday the 30th.
const MON2 = "2026-11-30", SAT2 = "2026-12-05", SUN2 = "2026-12-06";

describe("where a course falls on a date", () => {
  const stackway = curriculumById("stackway")!;
  const atlas = curriculumById("python-atlas")!;

  it("Stackway's day 1 waits for Monday when you start midweek", () => {
    // Saying "about to start W1D1" on a Thursday must not put the Saturday project on a Tuesday.
    expect(alignedAnchor(stackway, THU, { week: 1, day: 1 })).toBe(MON2);
    expect(positionOn(stackway, THU, { week: 1, day: 1 }, THU)).toBeNull();
    expect(positionOn(stackway, THU, { week: 1, day: 1 }, MON)).toBeNull(); // before it starts
    expect(positionOn(stackway, THU, { week: 1, day: 1 }, MON2)).toEqual({ week: 1, day: 1 });
  });

  it("keeps the project on Saturday and the review on Sunday, week after week", () => {
    for (const [date, day] of [[MON2, 1], [SAT2, 6], [SUN2, 7]] as const) {
      const pos = positionOn(stackway, THU, { week: 1, day: 1 }, date)!;
      expect(pos.day).toBe(day);
      expect(slotFor(stackway, pos.day)!.weekday).toBe(dayOfWeek(date));
    }
    // ...and a week later it is week 2, same slots.
    expect(positionOn(stackway, THU, { week: 1, day: 1 }, "2026-12-12")).toEqual({ week: 2, day: 6 });
    expect(slotFor(stackway, 6)!.kind).toBe("project");
    expect(slotFor(stackway, 7)!.kind).toBe("review");
  });

  it("a six-day course skips Sunday and rolls into the next week", () => {
    // Python Atlas is W1D5 on Monday the 23rd: Fri is D6, Sun is nothing, Mon is W2D1.
    expect(positionOn(atlas, MON, { week: 1, day: 5 }, MON)).toEqual({ week: 1, day: 5 });
    expect(positionOn(atlas, MON, { week: 1, day: 5 }, "2026-11-24")).toEqual({ week: 1, day: 6 });
    expect(positionOn(atlas, MON, { week: 1, day: 5 }, SUN)).toBeNull();
    expect(positionOn(atlas, MON, { week: 1, day: 5 }, "2026-11-25")).toEqual({ week: 2, day: 1 });
  });

  it("gives nothing before you started or after the course ends", () => {
    expect(positionOn(atlas, MON, { week: 1, day: 1 }, "2026-11-20")).toBeNull();
    expect(positionOn(atlas, MON, { week: 104, day: 6 }, "2026-11-24")).toBeNull();
  });
});

describe("the day's Bible passage", () => {
  it("covers the whole Bible across a year, in order and without gaps", () => {
    const plan = planById("bible-year")!;
    const flat = plan.schedule.flat();
    expect(flat.length).toBe(ALL_CHAPTERS.length);
    expect(flat.length).toBe(1189);
    expect(flat[0]).toEqual(["Gen", 1]);
    expect(flat[flat.length - 1]).toEqual(["Rev", 22]);
    expect(plan.schedule.every(d => d.length > 0)).toBe(true);
  });

  it("reads references the way Selah writes them", () => {
    expect(describeDay([["Gen", 1], ["Gen", 2], ["Gen", 3]])).toBe("Genesis 1–3");
    expect(describeDay([["Ps", 1], ["Ps", 2], ["Prov", 1]])).toBe("Psalms 1–2, Proverbs 1");
    expect(describeDay([["John", 3]])).toBe("John 3");
  });

  it("counts plan days from the day you started", () => {
    expect(planDay(MON, MON)).toBe(1);
    expect(planDay(MON, SAT)).toBe(6);
  });

  it("every plan fills all its days", () => {
    for (const p of plans()) expect(p.schedule.length).toBe(p.days);
  });
});

describe("pulling onto the shelf", () => {
  beforeEach(() => {
    _reset();
    setConfig("python-atlas", { on: true, week: 1, day: 5, anchorDate: MON });
  });

  it("offers a lesson for each working day, and never duplicates on a second pull", async () => {
    await pull(MON, "2026-11-28");
    const first = waiting();
    expect(first.length).toBe(6); // Python Atlas runs Mon-Sat, and the window is Mon-Sat
    expect(first.every(s => s.sourceId === "python-atlas")).toBe(true);
    expect(first[0].title).toContain("Week 1");

    await pull(MON, "2026-11-28");
    expect(waiting().length).toBe(first.length);
    expect(all("shelf").length).toBe(first.length);
  });

  it("drops an undecided item the source stops offering", async () => {
    await pull(MON, "2026-11-28");
    const before = waiting().length;
    setConfig("python-atlas", { week: 50, day: 1 }); // you jumped ahead: old ids no longer offered
    await pull(MON, "2026-11-28");
    expect(waiting().length).toBe(before); // same count, different items
    expect(waiting()[0].externalId).toContain("w50");
  });

  it("leaves a switched-off source's shelf alone", async () => {
    await pull(MON, "2026-11-28");
    const n = waiting().length;
    setConfig("python-atlas", { on: false });
    await pull(MON, "2026-11-28");
    expect(waiting().length).toBe(n);
  });
});

describe("deferring", () => {
  it("moves a day-bound item a week, not a day", () => {
    expect(nextSlot({ dayLock: 6 }, SAT)).toBe("2026-12-05"); // next Saturday
    expect(dayOfWeek(nextSlot({ dayLock: 6 }, SAT))).toBe(6);
    expect(nextSlot({ dayLock: null }, SAT)).toBe(SUN);
  });

  it("moves an unlocked item to the next day", () => {
    expect(nextSlot({ dayLock: null }, MON)).toBe("2026-11-24");
  });
});

describe("proposing a day", () => {
  beforeEach(() => _reset());

  it("does not put more on a day than the day holds", async () => {
    setConfig("python-atlas", { on: true, week: 1, day: 1, anchorDate: MON });
    await pull(MON, "2026-11-27");
    const cap = dayCapacity(); // 08:00–18:00 = 600 minutes
    expect(cap).toBe(600);

    const plan = propose(MON, 5);
    const perDay: Record<string, number> = {};
    for (const p of plan) perDay[p.date] = (perDay[p.date] ?? 0) + p.minutes;
    for (const [, mins] of Object.entries(perDay)) expect(mins).toBeLessThanOrEqual(cap);
    expect(plan.length).toBeGreaterThan(0);
  });

  it("counts what is already on the day, so a full day pushes the import out", async () => {
    setConfig("python-atlas", { on: true, week: 1, day: 1, anchorDate: MON });
    await pull(MON, "2026-11-27");
    // Fill Monday with your own work: 9 hours of it.
    addTask({ title: "TGIPay all day", due: MON, duration: 540 });
    const plan = propose(MON, 5);
    const monday = plan.filter(p => p.date === MON);
    // A 180-minute lesson cannot fit in the hour that's left.
    expect(monday.every(p => p.minutes <= 60)).toBe(true);
    expect(plan.some(p => p.moved)).toBe(true);
  });

  it("never gives a day more study than the budget allows", async () => {
    for (const id of ["python-atlas", "tracesmith", "mamba"]) setConfig(id, { on: true, week: 1, day: 1, anchorDate: MON });
    setConfig("bible", { on: true, planId: "bible-year", startedAt: MON });
    await pull(MON, "2026-12-04");
    expect(dailyBudget()).toBe(240); // four hours, not the whole ten-hour day

    const perDay: Record<string, number> = {};
    for (const p of propose(MON, 10)) perDay[p.date] = (perDay[p.date] ?? 0) + p.minutes;
    const days = Object.entries(perDay);
    expect(days.length).toBeGreaterThan(3);
    for (const [, mins] of days) expect(mins).toBeLessThanOrEqual(dailyBudget());
    // ...and the overflow really is spread out rather than dropped.
    expect(days.length).toBeGreaterThan(5);
  });

  it("gives a day-locked item first claim on its own day", async () => {
    // Stackway's Monday lesson can only be a Monday; Python Atlas's can be any weekday.
    // Without least-flexible-first the Stackway lesson is pushed a week at a time until it is lost.
    setConfig("stackway", { on: true, week: 1, day: 1, anchorDate: MON });
    setConfig("python-atlas", { on: true, week: 1, day: 1, anchorDate: MON });
    setConfig("tracesmith", { on: true, week: 1, day: 1, anchorDate: MON });
    await pull(MON, "2026-12-06");
    const plan = propose(MON, 14);
    expect(plan.some(p => get("shelf", p.shelfId)!.sourceId === "stackway")).toBe(true);
  });

  it("explains every move", async () => {
    setConfig("stackway", { on: true, week: 1, day: 1, anchorDate: MON });
    await pull(MON, "2026-12-13");
    const plan = propose(MON, 14);
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.why.length).toBeGreaterThan(0);
  });
});

describe("accepting", () => {
  beforeEach(() => _reset());

  it("writes one real task, carries the link, and cannot be accepted twice", async () => {
    setConfig("bible", { on: true, planId: "gospels-30", startedAt: MON });
    await pull(MON, MON);
    const [item] = waiting();
    expect(item.title).toContain("Matthew");

    const plan = propose(MON, 1);
    const p = plan.find(x => x.shelfId === item.id)!;
    const task = accept(p)!;
    expect(task.due).toBe(MON);
    expect(task.source).toBe("bible");
    expect(task.externalId).toBe(item.externalId);
    expect(task.sourceUrl).toContain("/bible/Matt/");
    expect(all("tasks").length).toBe(1);

    expect(accept(p)).toBeNull(); // already decided
    expect(all("tasks").length).toBe(1);
    expect(get("shelf", item.id)!.outcome).toBe("accepted");
    expect(waiting().length).toBe(0);
  });

  it("makes the project the item asked for, once", async () => {
    setConfig("tracesmith", { on: true, week: 1, day: 5, anchorDate: MON });
    await pull(MON, "2026-11-25");
    for (const p of propose(MON, 3)) accept(p);
    expect(all("projects").filter(p => p.name === "Tracesmith").length).toBe(1);
  });
});

describe("the source registry", () => {
  it("every source declares what it needs and refuses to run without it", () => {
    for (const s of SOURCES) {
      expect(s.problem({})).toBeTruthy();
      expect(s.fields.length).toBeGreaterThan(0);
      expect(sourceById(s.id)).toBe(s);
    }
  });

  it("a source with a broken config yields nothing rather than throwing", async () => {
    for (const s of SOURCES) {
      await expect(Promise.resolve(s.items({ from: MON, to: SAT, config: {} }))).resolves.toEqual([]);
    }
  });

  it("settings keep each source's config apart", () => {
    _reset();
    setConfig("mamba", { on: true, week: 2, day: 1, anchorDate: MON });
    setConfig("bible", { on: true, planId: "nt-90", startedAt: MON });
    expect(configFor("mamba").week).toBe(2);
    expect(configFor("bible").planId).toBe("nt-90");
    expect(Object.keys(settings().hub).sort()).toEqual(["bible", "mamba"]);
  });
});
