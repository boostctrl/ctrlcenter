import { describe, it, expect } from "vitest";
import { summarize } from "./status";

const up = { up: true };
const down = { up: false };

describe("summarize", () => {
  it("reports all up", () => {
    expect(summarize([up, up, up])).toEqual({
      up: 3,
      down: 0,
      total: 3,
      allUp: true,
    });
  });

  it("counts the down services", () => {
    expect(summarize([up, down, up, down])).toEqual({
      up: 2,
      down: 2,
      total: 4,
      allUp: false,
    });
  });

  it("treats empty input as not-all-up (nothing to report)", () => {
    expect(summarize([])).toEqual({ up: 0, down: 0, total: 0, allUp: false });
  });
});
