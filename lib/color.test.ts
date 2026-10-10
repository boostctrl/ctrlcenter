import { describe, it, expect } from "vitest";
import { contrast, derivePalette, hexToOklch, oklchToHex } from "./color";
import { SEMANTIC_KEYS } from "./theme";

describe("OKLCH round trip", () => {
  it("returns the same color for in-gamut inputs", () => {
    for (const hex of ["#a78bfa", "#22d3ee", "#06070d", "#f4f4f6", "#ff0000", "#00ff00", "#0000ff", "#808080"]) {
      const back = oklchToHex(hexToOklch(hex));
      const a = hexToOklch(hex);
      const b = hexToOklch(back);
      expect(Math.abs(a.l - b.l)).toBeLessThan(0.01);
      expect(Math.abs(a.c - b.c)).toBeLessThan(0.01);
    }
  });

  it("keeps hue and lightness when a color is out of gamut, reducing chroma", () => {
    const hex = oklchToHex({ l: 0.6, c: 0.4, h: 140 });
    const got = hexToOklch(hex);
    expect(Math.abs(got.l - 0.6)).toBeLessThan(0.03);
    expect(Math.abs(got.h - 140)).toBeLessThan(3);
    expect(got.c).toBeLessThan(0.4);
  });
});

describe("derivePalette (#332)", () => {
  // Every hue, bright and dim accents: the guarantees hold.
  const accents: string[] = [];
  for (let h = 0; h < 360; h += 15) {
    accents.push(oklchToHex({ l: 0.75, c: 0.15, h }));
    accents.push(oklchToHex({ l: 0.45, c: 0.1, h }));
  }
  accents.push("#808080", "#ffffff", "#000000");

  it("gives ink at 7:1, accents at 3:1 and semantic colors at 4.5:1 on both surfaces", () => {
    for (const accent of accents) {
      const p = derivePalette(accent);
      for (const [mode, status] of [
        ["dark", p.status],
        ["light", p.statusLight],
      ] as const) {
        const cs = p[mode];
        expect(contrast(cs.foreground, cs.background), `${accent} ${mode} ink`).toBeGreaterThanOrEqual(7);
        expect(contrast(cs.accentFrom, cs.background), `${accent} ${mode} accent`).toBeGreaterThanOrEqual(3);
        expect(contrast(cs.accentTo, cs.background), `${accent} ${mode} second`).toBeGreaterThanOrEqual(3);
        for (const k of SEMANTIC_KEYS) {
          expect(contrast(status[k], cs.background), `${accent} ${mode} ${k}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Dark is dark and light is light.
      expect(hexToOklch(p.dark.background).l).toBeLessThan(0.3);
      expect(hexToOklch(p.light.background).l).toBeGreaterThan(0.9);
    }
  });

  it("keeps the accent's hue and leans the surface toward it", () => {
    const p = derivePalette("#22d3ee");
    const accentHue = hexToOklch("#22d3ee").h;
    expect(Math.abs(hexToOklch(p.dark.accentFrom).h - accentHue)).toBeLessThan(5);
    expect(Math.abs(hexToOklch(p.dark.background).h - accentHue)).toBeLessThan(8);
    // The second stop sits an analogous step away.
    const second = hexToOklch(p.dark.accentTo).h;
    expect(Math.abs(((second - accentHue + 540) % 360) - 180 - 30) < 5 || Math.abs(second - accentHue - 30) < 5).toBe(true);
  });
});
