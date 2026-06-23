import { describe, it, expect } from "vitest";
import { summarize, matchesStatus } from "./status";

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

describe("matchesStatus", () => {
  it("matches anything for an empty/blank spec", () => {
    expect(matchesStatus(200, "")).toBe(true);
    expect(matchesStatus(500, "   ")).toBe(true);
    expect(matchesStatus(404, "")).toBe(true);
  });

  it("matches single codes", () => {
    expect(matchesStatus(200, "200")).toBe(true);
    expect(matchesStatus(204, "200, 204")).toBe(true);
    expect(matchesStatus(301, "200, 204")).toBe(false);
  });

  it("matches inclusive ranges (any order)", () => {
    expect(matchesStatus(250, "200-299")).toBe(true);
    expect(matchesStatus(299, "200-299")).toBe(true);
    expect(matchesStatus(300, "200-299")).toBe(false);
    expect(matchesStatus(250, "299-200")).toBe(true);
  });

  it("handles mixed lists of ranges and singles", () => {
    expect(matchesStatus(401, "200-299, 401")).toBe(true);
    expect(matchesStatus(404, "200-399")).toBe(false);
    expect(matchesStatus(204, "200-399")).toBe(true);
  });
});
