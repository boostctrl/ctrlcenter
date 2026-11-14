import { describe, it, expect } from "vitest";
import { BADGE_COLORS, formatUptime, renderBadge, textWidth, uptimeColor } from "./status-badge";

describe("renderBadge (#295)", () => {
  it("sizes each half to its text and colours the value side", () => {
    const svg = renderBadge("Plex", "up", BADGE_COLORS.up);
    const lw = textWidth("Plex") + 10;
    const vw = textWidth("up") + 10;
    expect(svg).toContain(`width="${lw + vw}"`);
    expect(svg).toContain(`<rect x="${lw}" width="${vw}" height="20" fill="#4c1"/>`);
    expect(svg).toContain('aria-label="Plex: up"');
  });

  it("escapes the label and value", () => {
    const svg = renderBadge(`<b>"A&B"</b>`, "up", BADGE_COLORS.up);
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
  });

  it("measures narrow letters narrower than wide ones", () => {
    expect(textWidth("iii")).toBeLessThan(textWidth("mmm"));
  });
});

describe("formatUptime", () => {
  it("never rounds a miss up to 100%", () => {
    expect(formatUptime(100)).toBe("100%");
    expect(formatUptime(99.999)).toBe("99.99%");
    expect(formatUptime(97.5)).toBe("97.50%");
    expect(formatUptime(99.9999999)).toBe("99.99%");
  });

  // #481: flooring pct * 100 took float noise for a real fraction.
  it("shows two-decimal values as they are", () => {
    for (const pct of [0.29, 0.57, 1.13, 50.01]) {
      expect(formatUptime(pct)).toBe(`${pct.toFixed(2)}%`);
    }
    for (let i = 0; i < 10_000; i++) {
      expect(formatUptime(i / 100)).toBe(`${(i / 100).toFixed(2)}%`);
    }
    expect(formatUptime((991 / 1000) * 100)).toBe("99.10%");
    expect(formatUptime((9 / 1000) * 100)).toBe("0.90%");
  });

  it("colours by how close to perfect", () => {
    expect(uptimeColor(99.9)).toBe(BADGE_COLORS.up);
    expect(uptimeColor(96)).toBe(BADGE_COLORS.fair);
    expect(uptimeColor(50)).toBe(BADGE_COLORS.down);
  });
});
