import { describe, it, expect } from "vitest";
import { WIDGET_DEFS, WIDGET_IDS, emptyReason, widgetsWith } from "./defs";
import { GRID_COLUMNS } from "../layout";

// The widget registry (#285).
describe("widget registry", () => {
  it("has unique ids, in table order", () => {
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_DEFS.length);
    expect([...WIDGET_IDS]).toEqual(WIDGET_DEFS.map((d) => d.id));
  });

  it("gives every widget a label, an in-grid default span and an empty reason", () => {
    for (const d of WIDGET_DEFS) {
      expect(d.label.trim(), d.id).not.toBe("");
      expect(d.span, d.id).toBeGreaterThanOrEqual(1);
      expect(d.span, d.id).toBeLessThanOrEqual(GRID_COLUMNS);
      expect(emptyReason(d.id, { statusEnabled: false }).trim(), d.id).not.toBe("");
    }
  });

  it("keeps the legacy header list frozen", () => {
    // These were the pre-grid fixed header; a saved layout missing them gets
    // them prepended. New widgets must never join this list.
    expect(widgetsWith("legacyHeader")).toEqual([
      "greeting",
      "headerCard",
      "clock",
      "weather",
      "status",
    ]);
  });
});
