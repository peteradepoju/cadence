import { beforeEach, describe, expect, it } from "vitest";
import { vet } from "./plan-ai";
import { dailyBudget, pull, setConfig, waiting } from "./hub";
import { _reset, all, settings } from "../store";
import { addTask } from "../actions";
import { dayOfWeek } from "../dates";

const MON = "2026-11-23";

async function shelf() {
  setConfig("stackway", { on: true, week: 1, day: 1, anchorDate: MON });
  setConfig("python-atlas", { on: true, week: 1, day: 1, anchorDate: MON });
  await pull(MON, "2026-12-06");
  return waiting();
}

describe("checking the AI's plan", () => {
  beforeEach(() => _reset());

  it("moves a day-locked item the AI put on the wrong day onto its own weekday", async () => {
    const items = await shelf();
    const locked = items.find(i => i.dayLock != null)!;
    expect(locked).toBeTruthy();
    // The AI puts a Monday-locked lesson on a Wednesday.
    const { placements } = vet({ plan: [{ id: locked.id, date: "2026-11-25", minutes: 60, why: "felt right" }] }, items, MON, 14);
    const p = placements.find(x => x.shelfId === locked.id)!;
    expect(p).toBeTruthy();
    expect(dayOfWeek(p.date)).toBe(locked.dayLock);
    expect(p.moved).toBe(true);
  });

  it("refuses to give a day more than the budget, however many items the AI piles on", async () => {
    const items = await shelf();
    const budget = dailyBudget();
    // The AI tries to put everything on Monday, each claiming three hours.
    const plan = items.map(i => ({ id: i.id, date: MON, minutes: 180, why: "all today" }));
    const { placements } = vet({ plan }, items, MON, 14);
    const monday = placements.filter(p => p.date === MON).reduce((n, p) => n + p.minutes, 0);
    expect(monday).toBeLessThanOrEqual(budget);
  });

  it("counts what the day already holds before adding to it", async () => {
    const items = await shelf();
    addTask({ title: "TGIPay", due: MON, duration: 520 }); // most of the working day is gone
    const plan = items.slice(0, 3).map(i => ({ id: i.id, date: MON, minutes: 180, why: "x" }));
    const { placements } = vet({ plan }, items, MON, 14);
    const monday = placements.filter(p => p.date === MON).reduce((n, p) => n + p.minutes, 0);
    expect(monday).toBeLessThanOrEqual(600 - 520);
  });

  it("obeys the daily task limit", async () => {
    const items = await shelf();
    const plan = items.map(i => ({ id: i.id, date: MON, minutes: 10, why: "x" }));
    const { placements } = vet({ plan }, items, MON, 14);
    expect(placements.filter(p => p.date === MON).length).toBeLessThanOrEqual(settings().dailyLimit);
  });

  it("ignores ids it doesn't know, dates outside the window and rubbish", async () => {
    const items = await shelf();
    const good = items[0];
    const { placements } = vet({
      plan: [
        { id: "made-up", date: MON, minutes: 30, why: "nope" },
        { id: good.id, date: "2027-06-01", minutes: 30, why: "far future" },
        { id: good.id, date: "not-a-date", minutes: 30, why: "junk date" },
        {},
      ],
    }, items, MON, 14);
    // The junk date falls back to the day it was offered for, which is inside the window.
    expect(placements.every(p => items.some(i => i.id === p.shelfId))).toBe(true);
    expect(placements.every(p => p.date >= MON && p.date <= "2026-12-06")).toBe(true);
  });

  it("never places the same item twice", async () => {
    const items = await shelf();
    const id = items[0].id;
    const { placements } = vet({ plan: [{ id, date: MON, minutes: 30 }, { id, date: "2026-11-24", minutes: 30 }] }, items, MON, 14);
    expect(placements.filter(p => p.shelfId === id).length).toBe(1);
  });

  it("accounts for every waiting item: planned, or dropped with a reason", async () => {
    const items = await shelf();
    const { placements, dropped } = vet({ plan: [{ id: items[0].id, date: MON, minutes: 30, why: "start here" }], dropped: [{ id: items[1].id, why: "too much this week" }] }, items, MON, 14);
    const accounted = new Set([...placements.map(p => p.shelfId), ...dropped.map(d => d.shelfId)]);
    expect(accounted.size).toBe(items.length);
    expect(dropped.find(d => d.shelfId === items[1].id)!.why).toBe("too much this week");
    // Items the AI forgot entirely are still reported rather than vanishing.
    expect(dropped.every(d => d.why.length > 0)).toBe(true);
  });

  it("keeps the AI's reason, and says so when it moved something", async () => {
    const items = await shelf();
    const free = items.find(i => i.dayLock == null)!;
    const { placements } = vet({ plan: [{ id: free.id, date: free.offeredFor!, minutes: 30, why: "high energy morning" }] }, items, MON, 14);
    expect(placements[0].why).toBe("high energy morning");
    expect(placements[0].moved).toBe(false);
  });

  it("survives an empty or malformed answer", async () => {
    const items = await shelf();
    for (const raw of [{}, { plan: [] }, { plan: undefined, dropped: undefined }]) {
      const r = vet(raw, items, MON, 14);
      expect(r.placements).toEqual([]);
      expect(r.dropped.length).toBe(items.length); // everything accounted for
    }
  });

  it("does not shorten an item beyond what it is", async () => {
    const items = await shelf();
    const it0 = items.find(i => (i.duration ?? 0) >= 60)!;
    const { placements } = vet({ plan: [{ id: it0.id, date: it0.offeredFor!, minutes: 9999, why: "x" }] }, items, MON, 14);
    expect(placements[0].minutes).toBeLessThanOrEqual(it0.duration!);
  });
});

describe("the shelf stays the source of truth", () => {
  beforeEach(() => _reset());
  it("vetting writes nothing", async () => {
    const items = await shelf();
    const before = all("tasks").length;
    vet({ plan: items.map(i => ({ id: i.id, date: MON, minutes: 30 })) }, items, MON, 14);
    expect(all("tasks").length).toBe(before);
  });
});
