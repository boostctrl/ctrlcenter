import { describe, it, expect } from "vitest";
import { isValidTimeZone, hourIn, shortDate, timeString } from "./datetime";

describe("isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
  });

  it("rejects typos and junk", () => {
    expect(isValidTimeZone("America/Chicagoo")).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("timezone helpers degrade instead of throwing", () => {
  // A hand-edited config or stale localStorage can carry an invalid zone, which
  // would otherwise throw a RangeError and crash SSR / the client clock.
  const noon = new Date("2026-06-25T12:00:00Z");

  it("does not throw on an invalid zone and falls back to UTC", () => {
    expect(() => hourIn(noon, "America/Chicagoo")).not.toThrow();
    expect(() => shortDate(noon, "Not/AZone")).not.toThrow();
    expect(() => timeString(noon, "garbage")).not.toThrow();
    // UTC noon → hour 12, regardless of the bad input zone.
    expect(hourIn(noon, "America/Chicagoo")).toBe(12);
  });

  it("still honors a valid zone", () => {
    // UTC noon is 07:00 in America/Chicago (CDT, UTC-5) on this date.
    expect(hourIn(noon, "America/Chicago")).toBe(7);
  });
});
