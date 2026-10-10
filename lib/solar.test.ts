import { describe, it, expect } from "vitest";
import { sunTimes } from "./solar";

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const minutesApart = (ms: number, iso: string) => Math.abs(ms - Date.parse(iso)) / 60000;

describe("sunTimes (#336)", () => {
  it("matches the almanac to a few minutes: London on the June solstice", () => {
    const t = sunTimes(2024, 6, 21, 51.5074, -0.1278);
    expect(t.kind).toBe("normal");
    if (t.kind !== "normal") return;
    // Civil sunrise 04:43 BST = 03:43Z, sunset 21:21 BST = 20:21Z.
    expect(minutesApart(t.sunrise, "2024-06-21T03:43:00Z")).toBeLessThan(4);
    expect(minutesApart(t.sunset, "2024-06-21T20:21:00Z")).toBeLessThan(4);
  });

  it("works west of Greenwich and in the southern hemisphere", () => {
    // Washington, DC on the December solstice: sunrise 07:23 EST = 12:23Z,
    // sunset 16:50 EST = 21:50Z.
    const dc = sunTimes(2024, 12, 21, 38.9072, -77.0369);
    expect(dc.kind).toBe("normal");
    if (dc.kind === "normal") {
      expect(minutesApart(dc.sunrise, "2024-12-21T12:23:00Z")).toBeLessThan(4);
      expect(minutesApart(dc.sunset, "2024-12-21T21:50:00Z")).toBeLessThan(4);
    }
    // Sydney the same day: sunrise 05:41 AEDT = 18:41Z the day before,
    // sunset 20:06 AEDT = 09:06Z.
    const syd = sunTimes(2024, 12, 21, -33.8688, 151.2093);
    expect(syd.kind).toBe("normal");
    if (syd.kind === "normal") {
      expect(minutesApart(syd.sunrise, "2024-12-20T18:41:00Z")).toBeLessThan(4);
      expect(minutesApart(syd.sunset, "2024-12-21T09:06:00Z")).toBeLessThan(4);
      expect(hhmm(syd.sunrise) < hhmm(syd.sunset)).toBe(false); // crosses the UTC day
    }
  });

  it("reports polar day and polar night", () => {
    expect(sunTimes(2024, 6, 21, 69.65, 18.96)).toEqual({ kind: "polar", day: true });
    expect(sunTimes(2024, 12, 21, 69.65, 18.96)).toEqual({ kind: "polar", day: false });
    // The same place at the equinox has a normal day.
    expect(sunTimes(2024, 3, 20, 69.65, 18.96).kind).toBe("normal");
  });
});
