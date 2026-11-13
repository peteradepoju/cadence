import { describe, expect, it, vi, beforeEach } from "vitest";
import { setSettings } from "./store";
import { silencePhone, unsilencePhone } from "./phone";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe("phone silencing", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("localStorage", new Mem());
    vi.stubGlobal("fetch", (u: string) => { calls.push(u); return Promise.resolve(new Response(null)); });
  });
  it("does nothing until it's switched on", () => {
    setSettings({ phoneSilence: false, phoneOnUrl: "https://trigger.macrodroid.com/x/on", phoneOffUrl: "https://trigger.macrodroid.com/x/off" });
    silencePhone(25); unsilencePhone();
    expect(calls).toEqual([]);
  });
  it("calls the on link with the length, then the off link once", () => {
    setSettings({ phoneSilence: true });
    silencePhone(25);
    expect(calls[0]).toMatch(/^https:\/\/trigger\.macrodroid\.com\/x\/on\?minutes=25&until=/);
    unsilencePhone(); unsilencePhone();
    expect(calls.filter(c => c.includes("/off"))).toHaveLength(1);
  });
  it("ignores links that aren't https", () => {
    setSettings({ phoneOnUrl: "http://example.com/on" });
    silencePhone(25);
    expect(calls).toEqual([]);
  });
});
