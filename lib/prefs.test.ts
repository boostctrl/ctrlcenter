import { describe, it, expect } from "vitest";
import { sanitizePrefs, sanitizeColors, sanitizeModeColors } from "./prefs";

const valid = {
  background: "#06070d",
  foreground: "#ffffff",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

describe("sanitizeColors", () => {
  it("accepts four valid 6-digit hex colors", () => {
    expect(sanitizeColors(valid)).toEqual(valid);
  });

  it("rejects non-objects and missing fields", () => {
    expect(sanitizeColors(null)).toBeNull();
    expect(sanitizeColors({ background: "#fff" })).toBeNull();
  });

  it("rejects non-hex or short-hex values", () => {
    expect(sanitizeColors({ ...valid, background: "red" })).toBeNull();
    expect(sanitizeColors({ ...valid, accentTo: "#fff" })).toBeNull();
    expect(
      sanitizeColors({ ...valid, foreground: "#12345g" })
    ).toBeNull();
  });
});

describe("sanitizeModeColors", () => {
  const light = { ...valid, background: "#eceef3", foreground: "#181b24" };

  it("accepts a {dark, light} pair", () => {
    expect(sanitizeModeColors({ dark: valid, light })).toEqual({
      dark: valid,
      light,
    });
  });

  it("migrates an old single color set to both modes", () => {
    // Back-compat: a value saved before looks were mode-aware was one flat set.
    expect(sanitizeModeColors(valid)).toEqual({ dark: valid, light: valid });
  });

  it("rejects junk and partial pairs", () => {
    expect(sanitizeModeColors(null)).toBeNull();
    expect(sanitizeModeColors({ dark: valid })).toBeNull();
    expect(sanitizeModeColors({ dark: valid, light: { background: "#fff" } })).toBeNull();
  });
});

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

  it("drops an invalid time zone so the clock can't crash on it", () => {
    expect(sanitizePrefs({ timezone: "America/Chicagoo" }).timezone).toBeUndefined();
    expect(sanitizePrefs({ timezone: "" }).timezone).toBeUndefined();
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
