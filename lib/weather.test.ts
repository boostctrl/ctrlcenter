import { describe, it, expect, vi, afterEach } from "vitest";
import {
  windDirectionLabel,
  windUnitLabel,
  precipUnitLabel,
  uvLabel,
  formatClock,
  unitSymbol,
  fetchWeather,
} from "./weather";

describe("windDirectionLabel", () => {
  it("maps cardinal degrees to compass points", () => {
    expect(windDirectionLabel(0)).toBe("N");
    expect(windDirectionLabel(90)).toBe("E");
    expect(windDirectionLabel(180)).toBe("S");
    expect(windDirectionLabel(270)).toBe("W");
    expect(windDirectionLabel(45)).toBe("NE");
  });

  it("wraps and handles out-of-range/negative degrees", () => {
    expect(windDirectionLabel(360)).toBe("N");
    expect(windDirectionLabel(720)).toBe("N");
    expect(windDirectionLabel(-90)).toBe("W");
  });
});

describe("uvLabel", () => {
  it("bands the WHO UV scale", () => {
    expect(uvLabel(0)).toBe("Low");
    expect(uvLabel(2.9)).toBe("Low");
    expect(uvLabel(3)).toBe("Moderate");
    expect(uvLabel(6)).toBe("High");
    expect(uvLabel(8)).toBe("Very high");
    expect(uvLabel(11)).toBe("Extreme");
  });
});

describe("formatClock", () => {
  it("formats local time strings as a 12-hour clock", () => {
    expect(formatClock("2026-06-23T06:42")).toBe("6:42 AM");
    expect(formatClock("2026-06-23T00:05")).toBe("12:05 AM");
    expect(formatClock("2026-06-23T12:00")).toBe("12:00 PM");
    expect(formatClock("2026-06-23T20:31")).toBe("8:31 PM");
  });

  it("returns a dash for malformed input", () => {
    expect(formatClock("nope")).toBe("—");
  });
});

describe("unit labels", () => {
  it("returns the right symbols per unit system", () => {
    expect(unitSymbol("imperial")).toBe("°F");
    expect(unitSymbol("metric")).toBe("°C");
    expect(windUnitLabel("imperial")).toBe("mph");
    expect(windUnitLabel("metric")).toBe("km/h");
    expect(precipUnitLabel("imperial")).toBe("in");
    expect(precipUnitLabel("metric")).toBe("mm");
  });
});

describe("fetchWeather", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mockFetch = (body: unknown, ok = true) =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok, json: async () => body })
    );

  it("returns the current conditions on a well-formed response", async () => {
    mockFetch({
      current: { temperature_2m: 21, relative_humidity_2m: 60, weather_code: 1 },
    });
    expect(await fetchWeather(0, 0, "metric")).toEqual({
      temperature: 21,
      humidity: 60,
      code: 1,
    });
  });

  it("returns null when a required numeric field is missing (no NaN render)", async () => {
    mockFetch({ current: { relative_humidity_2m: 60, weather_code: 1 } });
    expect(await fetchWeather(0, 0, "metric")).toBeNull();
  });

  it("coerces a missing humidity to 0 rather than failing", async () => {
    mockFetch({ current: { temperature_2m: 21, weather_code: 1 } });
    expect(await fetchWeather(0, 0, "metric")).toEqual({
      temperature: 21,
      humidity: 0,
      code: 1,
    });
  });
});
