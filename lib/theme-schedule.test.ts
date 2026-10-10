import { describe, it, expect } from "vitest";
import { scheduleState, themeWithPack, zonedParts, zonedToUtc } from "./theme-schedule";
import { THEME_PACKS } from "./theme";
import { settingsSchema, themeInputSchema } from "./schema";

const NY = "America/New_York";
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const at = (iso: string) => Date.parse(iso);
const fixed = { mode: "fixed" as const, dayStart: "07:00", nightStart: "19:00" };
const sun = { mode: "sun" as const, dayStart: "07:00", nightStart: "19:00" };

describe("zoned time (#336)", () => {
  it("reads the wall clock in a zone and finds the instant for one", () => {
    expect(zonedParts(at("2024-03-10T15:00:00Z"), NY)).toEqual({ y: 2024, m: 3, d: 10, h: 11, min: 0 });
    // 07:00 EST on March 9 is 12:00Z; after the spring forward on the 10th,
    // 07:00 EDT is 11:00Z.
    expect(zonedToUtc({ y: 2024, m: 3, d: 9, h: 7, min: 0 }, NY)).toBe(at("2024-03-09T12:00:00Z"));
    expect(zonedToUtc({ y: 2024, m: 3, d: 10, h: 7, min: 0 }, NY)).toBe(at("2024-03-10T11:00:00Z"));
    // An unknown zone reads as UTC rather than throwing.
    expect(zonedToUtc({ y: 2024, m: 1, d: 1, h: 0, min: 0 }, "Nowhere/Nope")).toBe(at("2024-01-01T00:00:00Z"));
  });
});

describe("scheduleState, fixed times (#336)", () => {
  it("knows the phase and the next switch in the site's zone, across midnight and a DST change", () => {
    // 11:00 EDT on March 10: day until 19:00 EDT (23:00Z).
    expect(scheduleState(fixed, LONDON, NY, at("2024-03-10T15:00:00Z"))).toEqual({
      phase: "day",
      nextSwitch: at("2024-03-10T23:00:00Z"),
    });
    // 20:00 EST on March 9: night until 07:00 EDT on the 10th (11:00Z).
    expect(scheduleState(fixed, LONDON, NY, at("2024-03-10T01:00:00Z"))).toEqual({
      phase: "night",
      nextSwitch: at("2024-03-10T11:00:00Z"),
    });
    // Exactly at a switch, the new phase.
    expect(scheduleState(fixed, LONDON, NY, at("2024-03-10T11:00:00Z")).phase).toBe("day");
  });

  it("takes a night that starts before the day on the clock", () => {
    const late = { mode: "fixed" as const, dayStart: "22:00", nightStart: "06:00" };
    expect(scheduleState(late, LONDON, "UTC", at("2024-01-01T23:00:00Z")).phase).toBe("day");
    expect(scheduleState(late, LONDON, "UTC", at("2024-01-01T12:00:00Z")).phase).toBe("night");
  });

  it("falls back to 07:00/19:00 for a malformed time", () => {
    const bad = { mode: "fixed" as const, dayStart: "7am", nightStart: "" };
    expect(scheduleState(bad, LONDON, "UTC", at("2024-01-01T08:00:00Z"))).toEqual({
      phase: "day",
      nextSwitch: at("2024-01-01T19:00:00Z"),
    });
  });
});

describe("scheduleState, sunrise and sunset (#336)", () => {
  it("follows the sun at the weather location", () => {
    const noon = scheduleState(sun, LONDON, "Europe/London", at("2024-06-21T12:00:00Z"));
    expect(noon.phase).toBe("day");
    expect(Math.abs(noon.nextSwitch! - at("2024-06-21T20:21:00Z"))).toBeLessThan(4 * 60000);
    const night = scheduleState(sun, LONDON, "Europe/London", at("2024-06-21T22:00:00Z"));
    expect(night.phase).toBe("night");
    expect(Math.abs(night.nextSwitch! - at("2024-06-22T03:43:00Z"))).toBeLessThan(4 * 60000);
  });

  it("holds a polar day or night, looking again at the next midnight", () => {
    const tromso = { latitude: 69.65, longitude: 18.96 };
    const day = scheduleState(sun, tromso, "Europe/Oslo", at("2024-06-21T12:00:00Z"));
    expect(day.phase).toBe("day");
    expect(day.nextSwitch).toBe(at("2024-06-21T22:00:00Z")); // midnight CEST on the 22nd
    expect(scheduleState(sun, tromso, "Europe/Oslo", at("2024-12-21T12:00:00Z")).phase).toBe("night");
  });
});

describe("themeWithPack (#336)", () => {
  const theme = settingsSchema.parse({}).theme;

  it("lays the pack over the site theme for both modes, with its own light parts only when they differ", () => {
    const tide = THEME_PACKS.find((p) => p.name === "Tide")!;
    const t = themeWithPack(theme, { ...tide, designLight: "paper" }, "dark");
    expect(t.mode).toBe("dark");
    expect(t.preset).toBe("Tide");
    expect(t.design).toBe(tide.design);
    expect(t.designLight).toBe("paper");
    expect(t.sceneLight).toBeUndefined();
    expect(t.background).toBe(tide.dark.background);
    expect(t.backgroundLight).toBe(tide.light.background);
    expect(t.accentFrom).toBe(tide.dark.accentFrom);
    expect(t.accentFromLight).toBe(tide.light.accentFrom === tide.dark.accentFrom ? undefined : tide.light.accentFrom);
    // What comes out is a valid site theme.
    expect(themeInputSchema.safeParse(t).success).toBe(true);
  });

  it("leaves the theme alone without a pack, taking only the mode", () => {
    expect(themeWithPack(theme, undefined)).toBe(theme);
    expect(themeWithPack(theme, undefined, "light").mode).toBe("light");
  });
});

describe("themeSchedule settings (#336)", () => {
  it("defaults to off at sunrise/sunset, and keeps a bad time at the default", () => {
    const s = settingsSchema.parse({});
    expect(s.themeSchedule).toEqual({ enabled: false, mode: "sun", day: "", night: "", dayStart: "07:00", nightStart: "19:00" });
    expect(settingsSchema.parse({ themeSchedule: { enabled: true, dayStart: "25:00" } }).themeSchedule.dayStart).toBe("07:00");
  });
});
