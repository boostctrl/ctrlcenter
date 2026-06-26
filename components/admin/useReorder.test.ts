import { describe, it, expect } from "vitest";
import { reorder } from "./useReorder";

const L = ["A", "B", "C", "D"];

describe("reorder", () => {
  it("moves an item down to the dropped index", () => {
    // Drop A onto C's slot (index 2): A ends up at index 2.
    expect(reorder(L, 0, 2)).toEqual(["B", "C", "A", "D"]);
  });

  it("moves an item up to the dropped index", () => {
    // Drop D onto B's slot (index 1): D ends up at index 1.
    expect(reorder(L, 3, 1)).toEqual(["A", "D", "B", "C"]);
  });

  it("can reach the very start and the very end", () => {
    expect(reorder(L, 3, 0)).toEqual(["D", "A", "B", "C"]);
    expect(reorder(L, 0, 3)).toEqual(["B", "C", "D", "A"]);
  });

  it("swaps adjacent items (the up/down button case)", () => {
    expect(reorder(L, 2, 1)).toEqual(["A", "C", "B", "D"]);
    expect(reorder(L, 1, 2)).toEqual(["A", "C", "B", "D"]);
  });

  it("is a no-op when from === to and never mutates the input", () => {
    const copy = [...L];
    expect(reorder(L, 1, 1)).toEqual(L);
    expect(L).toEqual(copy);
  });
});
