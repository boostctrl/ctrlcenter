import { describe, it, expect } from "vitest";
import { sanitizePrefs } from "./prefs";

describe("sanitizePrefs", () => {
  it("returns empty for non-objects", () => {
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs("nope")).toEqual({});
    expect(sanitizePrefs(42)).toEqual({});
  });

  it("keeps valid timezone, units, and dismissedAuto", () => {
    expect(
      sanitizePrefs({
        timezone: "America/Chicago",
        units: "metric",
        dismissedAuto: true,
      })
    ).toEqual({
      timezone: "America/Chicago",
      units: "metric",
      dismissedAuto: true,
    });
  });

  it("drops invalid units and non-true dismissedAuto", () => {
    const out = sanitizePrefs({ units: "kelvin", dismissedAuto: "yes" });
    expect(out.units).toBeUndefined();
    expect(out.dismissedAuto).toBeUndefined();
  });

  it("accepts a well-formed in-range location with a clamped label", () => {
    const out = sanitizePrefs({
      location: {
        latitude: 41.88,
        longitude: -87.63,
        label: "Chicago",
        source: "ip",
      },
    });
    expect(out.location).toMatchObject({
      latitude: 41.88,
      longitude: -87.63,
      label: "Chicago",
      source: "ip",
    });
  });

  it("rejects out-of-range or non-numeric coordinates", () => {
    expect(sanitizePrefs({ location: { latitude: 200, longitude: 0 } }).location).toBeUndefined();
    expect(
      sanitizePrefs({ location: { latitude: "x", longitude: 0 } }).location
    ).toBeUndefined();
  });

  it("defaults an unknown location source to manual", () => {
    const out = sanitizePrefs({
      location: { latitude: 1, longitude: 2, source: "satellite" },
    });
    expect(out.location?.source).toBe("manual");
  });
});
