import { describe, it, expect } from "vitest";
import { applyListPatch, diffList } from "./list-patch";

// Lists saved as what changed (#396).
type Item = { id: string; v: number };
const list = (...ids: string[]): Item[] => ids.map((id, i) => ({ id, v: i }));

describe("applyListPatch", () => {
  it("removes, replaces in place, appends new ids, and keeps what the patch doesn't name", () => {
    const stored = list("a", "b", "c");
    expect(applyListPatch(stored, { remove: ["b"] })).toEqual([stored[0], stored[2]]);
    expect(applyListPatch(stored, { upsert: [{ id: "b", v: 9 }] })).toEqual([stored[0], { id: "b", v: 9 }, stored[2]]);
    expect(applyListPatch(stored, { upsert: [{ id: "d", v: 4 }] })).toEqual([...stored, { id: "d", v: 4 }]);
    expect(applyListPatch(stored, {})).toEqual(stored);
  });

  it("orders by the given ids, with the ones it doesn't name after them in their old order", () => {
    const stored = list("a", "b", "c", "d");
    expect(applyListPatch(stored, { order: ["c", "a"] }).map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
    expect(applyListPatch(stored, { order: ["d", "c", "b", "a", "zzz"] }).map((i) => i.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("diffList", () => {
  it("is null when nothing changed, and names only what did", () => {
    const before = list("a", "b", "c");
    expect(diffList(before, [...before])).toBeNull();
    expect(diffList(before, [before[0], { id: "b", v: 9 }, before[2]])).toEqual({ upsert: [{ id: "b", v: 9 }] });
    expect(diffList(before, [before[0], before[2]])).toEqual({ remove: ["b"] });
    expect(diffList(before, [...before, { id: "d", v: 3 }])).toEqual({ upsert: [{ id: "d", v: 3 }] });
  });

  it("sends the order only when the upserts and removals alone wouldn't leave it right", () => {
    const before = list("a", "b", "c");
    expect(diffList(before, [before[2], before[0], before[1]])).toEqual({ order: ["c", "a", "b"] });
    // A new item in the middle needs the order; appended, it doesn't.
    const d = { id: "d", v: 7 };
    expect(diffList(before, [before[0], d, before[1], before[2]])).toEqual({ upsert: [d], order: ["a", "d", "b", "c"] });
    expect(diffList(before, [...before, d])).toEqual({ upsert: [d] });
  });

  it("round-trips: applying the diff to the old list gives the new one, edits elsewhere kept", () => {
    const before = list("a", "b", "c");
    const after = [{ id: "c", v: 2 }, { id: "a", v: 10 }, { id: "e", v: 5 }];
    const patch = diffList(before, after)!;
    expect(applyListPatch(before, patch)).toEqual(after);
    // Something another tab added meanwhile survives the same patch.
    const elsewhere = [...before, { id: "x", v: 42 }];
    expect(applyListPatch(elsewhere, patch).map((i) => i.id)).toEqual(["c", "a", "e", "x"]);
  });
});
