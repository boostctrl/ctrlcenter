import { describe, it, expect } from "vitest";
import { hexToRgb } from "./color";

describe("hexToRgb", () => {
  it("parses #rrggbb (with or without #)", () => {
    expect(hexToRgb("#ff8800")).toEqual([255, 136, 0]);
    expect(hexToRgb("00ff10")).toEqual([0, 255, 16]);
  });

  it("returns null for invalid input", () => {
    expect(hexToRgb("#fff")).toBeNull();
    expect(hexToRgb("nope")).toBeNull();
  });
});
