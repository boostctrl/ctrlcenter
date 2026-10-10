import { describe, it, expect } from "vitest";
import { dropIndex, type DropCard } from "./usePointerReorder";
import { snapHeight, AUTO_SNAP_PX } from "./useDragResize";

// The target-index math behind dragging cards (#312).
const card = (left: number, top: number, width: number, height: number, fullRow = false): DropCard => ({
  rect: { left, top, right: left + width, bottom: top + height },
  fullRow,
});

// Three cards side by side on a large screen: A | B | C, 100 wide each.
const row = [card(0, 0, 100, 50), card(120, 0, 100, 50), card(240, 0, 100, 50)];

describe("dropIndex", () => {
  it("lands before or after the nearest card, across for side-by-side cards", () => {
    const at = (x: number, current = 0) =>
      dropIndex({ pointer: { x, y: 25 }, cards: row, placeholder: null, current, sideBySide: true });
    expect(at(10)).toBe(0); // left half of A
    expect(at(90)).toBe(1); // right half of A
    expect(at(130, 0)).toBe(1); // left half of B
    expect(at(330, 0)).toBe(3); // right half of C: the end
    expect(at(1000, 0)).toBe(3); // far right, nearest is C
  });

  it("goes by height for stacked and full-row cards", () => {
    const stack = [card(0, 0, 300, 100, true), card(0, 120, 300, 100, true)];
    const at = (y: number) =>
      dropIndex({ pointer: { x: 150, y }, cards: stack, placeholder: null, current: 0, sideBySide: true });
    expect(at(10)).toBe(0);
    expect(at(90)).toBe(1);
    expect(at(210)).toBe(2);
    // Below lg everything stacks.
    expect(dropIndex({ pointer: { x: 90, y: 5 }, cards: row, placeholder: null, current: 2, sideBySide: false })).toBe(0);
  });

  it("holds still over its own placeholder, and in the band around a card's middle", () => {
    const placeholder = { left: 400, top: 0, right: 500, bottom: 50 };
    expect(dropIndex({ pointer: { x: 450, y: 25 }, cards: row, placeholder, current: 3, sideBySide: true })).toBe(3);
    // Just right of B's middle: the current answer (before B) holds…
    expect(dropIndex({ pointer: { x: 175, y: 25 }, cards: row, placeholder: null, current: 1, sideBySide: true })).toBe(1);
    // …but not an answer that isn't beside B.
    expect(dropIndex({ pointer: { x: 175, y: 25 }, cards: row, placeholder: null, current: 3, sideBySide: true })).toBe(2);
  });

  it("puts a card into an empty grid at the start", () => {
    expect(dropIndex({ pointer: { x: 0, y: 0 }, cards: [], placeholder: null, current: 0, sideBySide: true })).toBe(0);
  });
});

describe("snapHeight", () => {
  it("snaps to the step, and back to automatic near the content's height", () => {
    expect(snapHeight(247, 120)).toBe(240);
    expect(snapHeight(251, 120)).toBe(260);
    expect(snapHeight(120 + AUTO_SNAP_PX, 120)).toBeUndefined();
    expect(snapHeight(120 - AUTO_SNAP_PX + 1, 120)).toBeUndefined();
    expect(snapHeight(10, 300)).toBeGreaterThanOrEqual(40);
  });
});
