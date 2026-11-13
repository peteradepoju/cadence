// End-to-end sync: two devices, a fake Google Drive and a fake Google Tasks, in memory.
// Each device is a fresh copy of the app's modules with its own storage.
import { describe, expect, it, vi, beforeAll } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// ── fake Google ────────────────────────────────────────────────────────────
interface DFile { id: string; name: string; parents: string[]; mimeType: string; appProperties: Record<string, string>; modifiedTime: string; content: string; trashed: boolean }
interface GT { id: string; title: string; notes?: string; due?: string; status: string; completed?: string; deleted?: boolean; parent?: string; updated: string; list: string }
let clock = Date.now();
const tick = () => new Date((clock += 1000)).toISOString();
const drive = new Map<string, DFile>();
const lists = new Map<string, { id: string; title: string; updated: string }>([["L0", { id: "L0", title: "My Tasks", updated: tick() }]]);
const gtasks = new Map<string, GT>();
let nid = 0;
const id = (p: string) => `${p}${++nid}`;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  const p = url.pathname;
  // Drive
  if (p === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    let out = [...drive.values()].filter(f => !f.trashed);
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    if (parent) out = out.filter(f => f.parents.includes(parent));
    const tag = q.match(/value='([^']+)'/)?.[1];
    if (tag) out = out.filter(f => f.appProperties.cadence === tag);
    if (q.includes("mimeType='application/vnd.google-apps.folder'")) out = out.filter(f => f.mimeType.endsWith("folder"));
    return json({ files: out.map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties })) });
  }
  if (p === "/drive/v3/files" && method === "POST") {
    const b = JSON.parse(String(init.body));
    const f: DFile = { id: id("F"), name: b.name, parents: b.parents ?? [], mimeType: b.mimeType, appProperties: b.appProperties ?? {}, modifiedTime: tick(), content: "", trashed: false };
    drive.set(f.id, f); return json({ id: f.id });
  }
  if (p === "/upload/drive/v3/files" && method === "POST") {
    const form = init.body as FormData;
    const meta = JSON.parse(await (form.get("metadata") as Blob).text());
    const f: DFile = { id: id("F"), name: meta.name, parents: meta.parents, mimeType: meta.mimeType, appProperties: meta.appProperties ?? {}, modifiedTime: tick(), content: await (form.get("file") as Blob).text(), trashed: false };
    drive.set(f.id, f); return json({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });
  }
  let m = p.match(/^\/upload\/drive\/v3\/files\/(.+)$/);
  if (m && method === "PATCH") { const f = drive.get(m[1])!; f.content = await (init.body as Blob).text(); f.modifiedTime = tick(); return json({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }); }
  m = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (m && method === "GET") { const f = drive.get(m[1]); return f ? new Response(f.content, { status: 200 }) : json({}, 404); }
  if (m && method === "PATCH") { const f = drive.get(m[1]); if (f) f.trashed = true; return json({}); }
  // Google Tasks
  if (p === "/tasks/v1/users/@me/lists" && method === "GET") return json({ items: [...lists.values()] });
  if (p === "/tasks/v1/users/@me/lists" && method === "POST") { const l = { id: id("L"), title: JSON.parse(String(init.body)).title, updated: tick() }; lists.set(l.id, l); return json(l); }
  m = p.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks$/);
  if (m && method === "GET") {
    const since = url.searchParams.get("updatedMin");
    const showDeleted = url.searchParams.get("showDeleted") === "true";
    return json({ items: [...gtasks.values()].filter(t => t.list === m![1] && (!since || t.updated >= since) && (showDeleted || !t.deleted)).map(({ list: _l, ...t }) => t) });
  }
  if (m && method === "POST") {
    const b = JSON.parse(String(init.body));
    const t: GT = { id: id("T"), title: b.title, notes: b.notes, due: b.due ?? undefined, status: b.status, parent: url.searchParams.get("parent") ?? undefined, updated: tick(), list: m[1] };
    if (t.status === "completed") t.completed = t.updated;
    gtasks.set(t.id, t); return json(t);
  }
  m = p.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/);
  if (m && method === "PATCH") {
    const t = gtasks.get(m[2]); if (!t || t.deleted) return json({}, 404);
    const b = JSON.parse(String(init.body));
    Object.assign(t, { title: b.title, notes: b.notes, due: b.due ?? undefined, status: b.status, updated: tick() });
    if (b.status === "completed" && !t.completed) t.completed = t.updated;
    if (b.status !== "completed") delete t.completed;
    return json(t);
  }
  if (m && method === "DELETE") { const t = gtasks.get(m[2]); if (t) { t.deleted = true; t.updated = tick(); } return new Response(null, { status: 204 }); }
  m = p.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/);
  if (m && method === "POST") { const t = gtasks.get(m[2])!; const dest = url.searchParams.get("destinationTasklist"); if (dest) t.list = dest; t.parent = url.searchParams.get("parent") ?? undefined; t.updated = tick(); return json(t); }
  throw new Error(`fake fetch: no route for ${method} ${url.href}`);
}

// ── devices ────────────────────────────────────────────────────────────────
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); } removeItem(k: string) { this.m.delete(k); } key(i: number) { return [...this.m.keys()][i] ?? null; } get length() { return this.m.size; } clear() { this.m.clear(); } }

interface Device { name: string; ls: Mem; idb: IDBFactory; mods: { store: typeof import("./store"); actions: typeof import("./actions"); sync: typeof import("./sync") } }

async function makeDevice(name: string): Promise<Device> {
  const ls = new Mem();
  ls.setItem("cadence:device", name);
  ls.setItem("cadence:g:account", JSON.stringify({ email: "me@example.com", name: "Me", picture: "" }));
  ls.setItem("cadence:g:token", JSON.stringify({ access: "t", exp: Date.now() + 3600_000 * 24, scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/tasks"] }));
  ls.setItem("cadence:g:wanted", JSON.stringify(["base", "tasks"]));
  const dev = { name, ls, idb: new IDBFactory() } as Device;
  use(dev);
  vi.resetModules();
  dev.mods = { store: await import("./store"), actions: await import("./actions"), sync: await import("./sync") };
  await dev.mods.store.loadStore();
  return dev;
}
function use(d: Device) {
  Object.defineProperty(globalThis, "localStorage", { value: d.ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, "indexedDB", { value: d.idb, configurable: true, writable: true });
}
async function sync(d: Device) { use(d); await d.mods.sync.syncNow(); const st = d.mods.sync.syncState(); if (st.status !== "synced") throw new Error(`${d.name}: ${st.status} ${st.error ?? ""}`); }
const titles = (d: Device) => d.mods.store.all("tasks").map(t => t.title).sort();

beforeAll(() => {
  vi.stubGlobal("fetch", fakeFetch);
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
});

describe("sync between devices through Drive", () => {
  let phone: Device, laptop: Device;
  it("a task made on one device reaches the other", async () => {
    phone = await makeDevice("phone");
    laptop = await makeDevice("laptop");
    use(phone); phone.mods.actions.addTask({ title: "Buy bread" });
    await sync(phone);
    await sync(laptop);
    expect(titles(laptop)).toEqual(["Buy bread"]);
  });
  it("editing different fields of the same task on both devices keeps both", async () => {
    use(phone); const t = phone.mods.store.all("tasks")[0];
    phone.mods.actions.completeTask(t.id);
    use(laptop); laptop.mods.actions.updateTask(t.id, { title: "Buy bread and milk" });
    await sync(phone); await sync(laptop); await sync(phone);
    for (const d of [phone, laptop]) {
      use(d);
      const x = d.mods.store.get("tasks", t.id)!;
      expect(x.title).toBe("Buy bread and milk");
      expect(x.done).toBe(true);
    }
  });
  it("tasks added offline on both devices all survive", async () => {
    use(phone); phone.mods.actions.addTask({ title: "Phone task" });
    use(laptop); laptop.mods.actions.addTask({ title: "Laptop task" });
    await sync(laptop); await sync(phone); await sync(laptop);
    expect(titles(phone)).toEqual(titles(laptop));
    expect(titles(phone)).toEqual(["Buy bread and milk", "Laptop task", "Phone task"]);
  });
  it("a delete on one device removes it everywhere", async () => {
    use(phone); const t = phone.mods.store.all("tasks").find(x => x.title === "Phone task")!;
    phone.mods.actions.deleteTask(t.id);
    await sync(phone); await sync(laptop);
    expect(titles(laptop)).not.toContain("Phone task");
  });
  it("each device writes only its own file", () => {
    const names = [...drive.values()].filter(f => f.name.startsWith("device-")).map(f => f.name).sort();
    expect(names).toEqual(["device-laptop.json", "device-phone.json"]);
  });

  it("Google Tasks: Cadence → Google, Google → Cadence, both ways", async () => {
    use(phone);
    phone.mods.store.setSettings({ gtasksOn: true });
    phone.mods.actions.addTask({ title: "Renew passport", due: "2026-11-20" });
    const work = phone.mods.actions.addProject({ name: "Work" });
    phone.mods.actions.addTask({ title: "Send invoice", projectId: work.id });
    await sync(phone);
    const inG = [...gtasks.values()].filter(t => !t.deleted);
    expect(inG.map(t => t.title).sort()).toContain("Renew passport");
    expect(inG.find(t => t.title === "Renew passport")!.due).toBe("2026-11-20T00:00:00.000Z");
    const workList = [...lists.values()].find(l => l.title === "Work")!;
    expect(inG.find(t => t.title === "Send invoice")!.list).toBe(workList.id);

    // edited in the Google Tasks app
    const g = inG.find(t => t.title === "Renew passport")!;
    Object.assign(g, { title: "Renew passport (book slot)", status: "completed", completed: tick(), updated: tick() });
    const fromG: GT = { id: "TG1", title: "Made in Google Tasks", status: "needsAction", updated: tick(), list: "L0" };
    gtasks.set(fromG.id, fromG);
    // a new list in Google becomes a project
    lists.set("LX", { id: "LX", title: "Groceries", updated: tick() });
    gtasks.set("TG2", { id: "TG2", title: "Eggs", status: "needsAction", updated: tick(), list: "LX" });
    await sync(phone);
    const pt = phone.mods.store.all("tasks");
    expect(pt.find(t => t.gId === g.id)!.title).toBe("Renew passport (book slot)");
    expect(pt.find(t => t.gId === g.id)!.done).toBe(true);
    expect(pt.find(t => t.title === "Made in Google Tasks")!.projectId).toBeNull();
    const groceries = phone.mods.store.all("projects").find(p => p.name === "Groceries")!;
    expect(pt.find(t => t.title === "Eggs")!.projectId).toBe(groceries.id);

    // the laptop gets it all through Drive, and syncing Google Tasks there doesn't duplicate anything
    use(laptop); laptop.mods.store.setSettings({ gtasksOn: true });
    await sync(laptop); await sync(laptop);
    const live = [...gtasks.values()].filter(t => !t.deleted);
    expect(new Set(live.map(t => t.title)).size).toBe(live.length);
    expect(titles(laptop)).toContain("Eggs");
  });

  it("Google Tasks: ticking a repeating task off in Google moves it to its next date", async () => {
    use(phone);
    const t = phone.mods.actions.addTask({ title: "Water plants", due: "2026-11-13", recurrence: { freq: "daily", interval: 3 } });
    await sync(phone);
    const g = [...gtasks.values()].find(x => x.title === "Water plants")!;
    Object.assign(g, { status: "completed", completed: tick(), updated: tick() });
    await sync(phone);
    const after = phone.mods.store.get("tasks", t.id)!;
    expect(after.done).toBe(false);
    expect(after.due! > "2026-11-13").toBe(true);
    await sync(phone);
    expect(g.status).toBe("needsAction");
    expect(g.due).toBe(`${after.due}T00:00:00.000Z`);
  });

  it("Google Tasks: deleting in Cadence deletes in Google, and the other way", async () => {
    use(phone);
    const t = phone.mods.store.all("tasks").find(x => x.title === "Send invoice")!;
    const gid = t.gId!;
    phone.mods.actions.deleteTask(t.id);
    await sync(phone);
    expect(gtasks.get(gid)!.deleted).toBe(true);
    const eggs = gtasks.get("TG2")!; eggs.deleted = true; eggs.updated = tick();
    await sync(phone);
    expect(titles(phone)).not.toContain("Eggs");
  });
});
