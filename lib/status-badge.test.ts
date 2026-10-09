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
  });

  it("colours by how close to perfect", () => {
    expect(uptimeColor(99.9)).toBe(BADGE_COLORS.up);
    expect(uptimeColor(96)).toBe(BADGE_COLORS.fair);
    expect(uptimeColor(50)).toBe(BADGE_COLORS.down);
  });
});
