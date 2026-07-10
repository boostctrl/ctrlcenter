import { describe, it, expect } from "vitest";
import { reorder, dropIndicatorClass } from "./useReorder";

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

describe("dropIndicatorClass", () => {
  it("draws the top line on the hovered row when the drop lands above it", () => {
    expect(
      dropIndicatorClass(2, { dragIndex: 3, overIndex: 2, dropEdge: "top" })
    ).toBe("border-t-2 border-t-violet-400");
  });

  it("draws the bottom line on the hovered row when the drop lands below it", () => {
    expect(
      dropIndicatorClass(2, { dragIndex: 0, overIndex: 2, dropEdge: "bottom" })
    ).toBe("border-b-2 border-b-violet-400");
  });

  it("is empty for rows other than the hovered one", () => {
    expect(
      dropIndicatorClass(1, { dragIndex: 0, overIndex: 2, dropEdge: "bottom" })
    ).toBe("");
  });

  it("is empty for the row being dragged even when it is the hovered row", () => {
    expect(
      dropIndicatorClass(2, { dragIndex: 2, overIndex: 2, dropEdge: "top" })
    ).toBe("");
  });

  it("is empty when nothing is being dragged", () => {
    expect(
      dropIndicatorClass(2, { dragIndex: null, overIndex: null, dropEdge: null })
    ).toBe("");
  });
});
