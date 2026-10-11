import { describe, it, expect } from "vitest";
import { cellBleed, cellSizing, MAX_CELL_BLEED } from "./sizing";

// How a grid cell takes a widget's explicit height (#353).
describe("cellSizing", () => {
  it("gives a content widget the scrolling cell and its exact height", () => {
    const { className, style, clip } = cellSizing({ type: "apps", height: 220 });
    expect(className).toBe("widget-sized");
    expect(style).toEqual({ height: 220 });
    expect(clip).toBeUndefined();
  });

  it("centers the others in the height inside a clip box that stands off the cell (#354)", () => {
    const { className, style, clip } = cellSizing({ type: "headerCard", height: 160 });
    expect(className).toContain("widget-centered");
    expect(className).toContain("lg:h-[var(--widget-height)]");
    // The cell itself never clips: the box inside it does, in every engine.
    expect(className).not.toContain("overflow");
    expect(style).toEqual({ "--widget-height": "160px" });
    expect(clip).toBe(true);
  });

  it("leaves a cell at auto height alone", () => {
    expect(cellSizing({ type: "apps" })).toEqual({ className: "" });
    expect(cellSizing({ type: "greeting", height: 0 })).toEqual({ className: "" });
  });
});

describe("cellBleed", () => {
  it("is the row gap, capped, as a plain px length (overflow-clip-margin takes no calc)", () => {
    expect(cellBleed(32)).toBe("32px");
    expect(cellBleed(64)).toBe(`${MAX_CELL_BLEED}px`);
    expect(cellBleed(0)).toBe("0px");
    for (const gap of [0, 4, 32, 96]) expect(cellBleed(gap)).toMatch(/^\d+px$/);
  });
});
