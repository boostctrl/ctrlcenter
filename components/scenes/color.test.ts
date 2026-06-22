import { describe, it, expect } from "vitest";
import { hexToRgb, mixHex } from "./color";

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

describe("mixHex", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("0, 0, 0");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("255, 255, 255");
  });

  it("blends at the midpoint", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("128, 128, 128");
    expect(mixHex("#204060", "#608020", 0.5)).toBe("64, 96, 64");
  });

  it("clamps t to [0, 1]", () => {
    expect(mixHex("#000000", "#ffffff", -1)).toBe("0, 0, 0");
    expect(mixHex("#000000", "#ffffff", 2)).toBe("255, 255, 255");
  });
});
