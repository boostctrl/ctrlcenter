import { describe, it, expect } from "vitest";
import { conditionWash } from "./WeatherDetails";

describe("conditionWash", () => {
  // #485: the snow test ran first and took in 71–86, so rain showers
  // (80–82) got the brighter snow wash.
  it("gives rain showers the rain wash and snow showers the snow wash", () => {
    const rain = conditionWash(61, true);
    const snow = conditionWash(71, true);
    expect(rain).not.toBe(snow);
    for (const code of [80, 81, 82]) expect(conditionWash(code, true)).toBe(rain);
    for (const code of [85, 86]) expect(conditionWash(code, true)).toBe(snow);
  });
});
