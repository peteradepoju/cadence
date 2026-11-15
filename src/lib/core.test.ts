import { describe, expect, it } from "vitest";
import { dominates, makeStamp, mergeData, mergeRec, setFields, slimTombstones, stampAt } from "./crdt";
import { nextDate, occurrences, describeRule, toRRule } from "./recurrence";
import { parseCapture } from "./parse";
import { weekKey, weekStartOf, addMonths } from "./dates";

describe("field-by-field sync", () => {
  it("keeps both edits made on two devices at once", () => {
    const base = setFields(undefined, "t1", { title: "Buy bread", done: false }, makeStamp("a"));
    const phone = setFields(base, "t1", { done: true }, makeStamp("phone"));
    const laptop = setFields(base, "t1", { title: "Buy bread and milk" }, makeStamp("laptop"));
    const m1 = mergeRec(phone, laptop), m2 = mergeRec(laptop, phone);
    expect(m1.f).toEqual({ title: "Buy bread and milk", done: true });
    expect(m2.f).toEqual(m1.f);
  });
  it("newer edit of the same field wins, whichever order they arrive in", () => {
    const a = setFields(undefined, "x", { title: "one" }, makeStamp("a"));
    const b = setFields(a, "x", { title: "two" }, makeStamp("b"));
    expect(mergeRec(a, b).f.title).toBe("two");
    expect(mergeRec(b, a).f.title).toBe("two");
    expect(mergeRec(b, a)).toBe(b); // nothing new
  });
  it("adds new records from both sides and a delete is never undone by an old copy", () => {
    const s1 = makeStamp("a");
    const a = { tasks: { t1: setFields(undefined, "t1", { title: "A" }, s1) } };
    const b = { tasks: { t2: setFields(undefined, "t2", { title: "B" }, makeStamp("b")) } };
    const ab = mergeData(a, b).data;
    expect(Object.keys(ab.tasks).sort()).toEqual(["t1", "t2"]);
    const del = { tasks: { t1: setFields(ab.tasks.t1, "t1", { deleted: true }, makeStamp("b")) } };
    const after = mergeData(mergeData(ab, del).data, a).data;
    expect(after.tasks.t1.f.deleted).toBe(true);
  });
  it("knows when one copy holds everything in another", () => {
    const a = { tasks: { t1: setFields(undefined, "t1", { title: "A" }, makeStamp("a")) } };
    const b = mergeData(a, { tasks: { t2: setFields(undefined, "t2", { title: "B" }, makeStamp("b")) } }).data;
    expect(dominates(b, a)).toBe(true);
    expect(dominates(a, b)).toBe(false);
  });
  it("slims old tombstones but keeps them deleted", () => {
    const old = stampAt(Date.now() - 100 * 86400000, "a");
    const r = setFields(setFields(undefined, "t", { title: "x" }, old), "t", { deleted: true }, old);
    const slim = slimTombstones({ tasks: { t: r } }, 30 * 86400000);
    expect(slim.tasks.t.f).toEqual({ deleted: true });
    expect(mergeData(slim, { tasks: { t: r } }).data.tasks.t.f.deleted).toBe(true);
  });
  it("stamps from outside (Google) compare by time", () => {
    expect(stampAt(2000, "google") > stampAt(1000, "zzz")).toBe(true);
  });
});

describe("repeats", () => {
  it("daily, every n days", () => {
    expect(nextDate({ freq: "daily", interval: 1 }, "2026-11-13")).toBe("2026-11-14");
    expect(nextDate({ freq: "daily", interval: 3 }, "2026-11-30")).toBe("2026-12-03");
  });
  it("weekly on chosen days", () => {
    // 2026-11-13 is a Friday
    const r = { freq: "weekly" as const, interval: 1, days: [1, 3, 5] };
    expect(nextDate(r, "2026-11-13")).toBe("2026-11-16");
    expect(nextDate(r, "2026-11-16")).toBe("2026-11-18");
    expect(nextDate({ freq: "weekly", interval: 2, days: [1] }, "2026-11-16")).toBe("2026-11-30");
  });
  it("monthly keeps the day, clamps short months", () => {
    expect(nextDate({ freq: "monthly", interval: 1, monthDay: 31 }, "2026-01-31")).toBe("2026-02-28");
    expect(nextDate({ freq: "monthly", interval: 1, monthDay: 31 }, "2026-02-28")).toBe("2026-03-31");
    expect(nextDate({ freq: "monthly", interval: 1, nth: { week: 2, day: 2 } }, "2026-11-10")).toBe("2026-12-08");
    expect(nextDate({ freq: "monthly", interval: 1, nth: { week: -1, day: 5 } }, "2026-11-27")).toBe("2026-12-25");
  });
  it("stops at until", () => {
    expect(nextDate({ freq: "daily", interval: 1, until: "2026-11-13" }, "2026-11-13")).toBeNull();
  });
  it("lists occurrences and describes", () => {
    expect(occurrences({ freq: "weekly", interval: 1, days: [1] }, "2026-11-16", "2026-11-01", "2026-11-30")).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(describeRule({ freq: "weekly", interval: 1, days: [1, 2, 3, 4, 5] })).toBe("Every weekday");
    expect(toRRule({ freq: "weekly", interval: 2, days: [1, 3] })).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
  });
});

describe("quick capture", () => {
  const T = "2026-11-13"; // Friday
  it("reads the example from the brief", () => {
    const p = parseCapture("call mum fri 6pm #family", { today: T });
    expect(p.title).toBe("call mum");
    expect(p.due).toBe("2026-11-13");
    expect(p.time).toBe("18:00");
    expect(p.tags).toEqual(["family"]);
  });
  it("priority, project with spaces, duration", () => {
    const p = parseCapture("Write report /Side Project !1 tomorrow for 1h30", { today: T, projects: ["Side Project", "Side"] });
    expect(p).toMatchObject({ title: "Write report", project: "Side Project", priority: 1, due: "2026-11-14", duration: 90 });
  });
  it("repeats", () => {
    expect(parseCapture("Gym every mon, wed and fri 7am", { today: T }).recurrence).toEqual({ freq: "weekly", interval: 1, days: [1, 3, 5] });
    expect(parseCapture("Water plants every 3 days", { today: T }).recurrence).toEqual({ freq: "daily", interval: 3 });
    const rent = parseCapture("Pay rent every month on the 1st", { today: T });
    expect(rent.recurrence).toEqual({ freq: "monthly", interval: 1, monthDay: 1 });
    expect(rent.due).toBe("2026-12-01");
    expect(parseCapture("Standup every weekday 9:30", { today: T }).time).toBe("09:30");
  });
  it("dates in many shapes", () => {
    expect(parseCapture("x next week", { today: T }).due).toBe("2026-11-16");
    expect(parseCapture("x next friday", { today: T }).due).toBe("2026-11-20");
    expect(parseCapture("x in 3 days", { today: T }).due).toBe("2026-11-16");
    expect(parseCapture("x 25 dec", { today: T }).due).toBe("2026-12-25");
    expect(parseCapture("x jan 5", { today: T }).due).toBe("2027-01-05");
    expect(parseCapture("x 2027-02-01", { today: T }).due).toBe("2027-02-01");
    expect(parseCapture("x tomorrow evening", { today: T }).time).toBe("18:00");
  });
  it("leaves ordinary words alone", () => {
    const p = parseCapture("Read the monday memo about sat scores", { today: T });
    expect(p.title.length).toBeGreaterThan(5);
    expect(parseCapture("Email Satya", { today: T }).title).toBe("Email Satya");
  });
});

describe("dates", () => {
  it("weeks", () => {
    expect(weekKey("2026-11-13")).toBe("2026-W46");
    expect(weekStartOf("2026-W46")).toBe("2026-11-09");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

import { taskEvents, eventId } from "./gcal";
import { newTask } from "./model";
describe("calendar events", () => {
  it("a timed task becomes one event with pop-up reminders; the id is the same on every device", () => {
    const t = newTask({ id: "abc", title: "Call mum", due: "2030-01-10", time: "18:00", duration: 20, reminders: [{ id: "r1", before: 15 }, { id: "r2", before: 1440 }] }, "d");
    const [ev, ...rest] = taskEvents(t);
    expect(rest).toEqual([]);
    expect(ev.id).toBe(eventId("t", "abc"));
    expect(/^[0-9a-v]{5,}$/.test(ev.id)).toBe(true);
    expect(ev.start?.dateTime).toBe("2030-01-10T18:00:00");
    expect(ev.end?.dateTime).toBe("2030-01-10T18:20:00");
    expect(ev.reminders?.overrides).toEqual([{ method: "popup", minutes: 15 }, { method: "popup", minutes: 1440 }]);
  });
  it("a reminder after the start time gets its own small event; done tasks have none", () => {
    const t = newTask({ id: "x", title: "Pay rent", due: "2030-01-10", reminders: [{ id: "r", at: "2030-01-10T15:00:00" }] }, "d");
    const evs = taskEvents(t);
    expect(evs).toHaveLength(2);
    expect(evs[1].summary).toBe("⏰ Pay rent");
    expect(taskEvents({ ...t, done: true })).toEqual([]);
  });
  it("a dated task without time or reminders is an all-day event", () => {
    const [ev] = taskEvents(newTask({ id: "y", title: "Passport", due: "2030-01-10" }, "d"));
    expect(ev.start).toEqual({ date: "2030-01-10" });
    expect(ev.end).toEqual({ date: "2030-01-11" });
  });
});
