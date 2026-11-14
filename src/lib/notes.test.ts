import { describe, expect, it } from "vitest";
import { applyFormat, continueList, toggleCheck } from "../components/notes";

describe("notes formatting", () => {
  it("bullets, numbers and checklists over the selected lines, and toggles back", () => {
    const t = "milk\neggs";
    expect(applyFormat(t, 0, t.length, "ul").value).toBe("- milk\n- eggs");
    expect(applyFormat(t, 0, t.length, "ol").value).toBe("1. milk\n2. eggs");
    expect(applyFormat(t, 0, t.length, "check").value).toBe("- [ ] milk\n- [ ] eggs");
    expect(applyFormat("- milk\n- eggs", 0, 13, "ul").value).toBe("milk\neggs");
    expect(applyFormat("- milk", 0, 6, "ol").value).toBe("1. milk");
  });
  it("wraps the selection in bold, or inserts a placeholder", () => {
    expect(applyFormat("call mum", 5, 8, "bold")).toEqual({ value: "call **mum**", start: 7, end: 10 });
    expect(applyFormat("", 0, 0, "italic").value).toBe("*text*");
    expect(applyFormat("see docs", 4, 8, "link").value).toBe("see [docs](https://)");
  });
  it("lists continue on Enter and end on an empty item", () => {
    expect(continueList("- milk", 6)).toEqual({ value: "- milk\n- ", pos: 9 });
    expect(continueList("1. milk", 7)!.value).toBe("1. milk\n2. ");
    expect(continueList("- [x] milk", 10)!.value).toBe("- [x] milk\n- [ ] ");
    expect(continueList("- milk\n- ", 9)).toEqual({ value: "- milk\n", pos: 7 });
    expect(continueList("plain", 5)).toBeNull();
  });
  it("ticks checklist items", () => {
    expect(toggleCheck("- [ ] a\n- [x] b", 0)).toBe("- [x] a\n- [x] b");
    expect(toggleCheck("- [ ] a\n- [x] b", 1)).toBe("- [ ] a\n- [ ] b");
  });
});
