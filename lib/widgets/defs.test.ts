import { describe, it, expect } from "vitest";
import { WIDGET_DEFS, WIDGET_IDS, emptyReason } from "./defs";
import { DEFAULT_INSTANCES, widgetInstanceSchema } from "../schema";
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

  it("has an instance schema for every widget type, and no other (#297)", () => {
    // One stock instance per type, but the types a config has to set up
    // first (an integration tile, #301).
    expect(DEFAULT_INSTANCES.map((w) => w.type)).toEqual(WIDGET_IDS.filter((id) => id !== "integration"));
    for (const type of WIDGET_IDS) {
      expect(widgetInstanceSchema.safeParse({ id: "x", type }).success, type).toBe(true);
    }
    expect(widgetInstanceSchema.safeParse({ id: "x", type: "nope" }).success).toBe(false);
  });
});
