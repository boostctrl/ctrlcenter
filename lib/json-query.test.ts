import { describe, it, expect } from "vitest";
import { evaluateJsonQuery, parseJsonQuery, type JsonQuery } from "./json-query";

// The JSON query check (#294).
const q = (src: string): JsonQuery => {
  const parsed = parseJsonQuery(src);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
};
const data = {
  status: "ok",
  queue: { depth: 7, workers: ["a", "b"] },
  count: "12",
  healthy: true,
  "dotted.key": 1,
};

describe("parseJsonQuery", () => {
  it("parses dot, index and quoted segments with a comparison", () => {
    expect(q('$.queue.workers[1] == "b"')).toEqual({
      path: ["queue", "workers", 1],
      op: "==",
      value: "b",
    });
    expect(q(`$['dotted.key']`)).toEqual({ path: ["dotted.key"], op: null });
    expect(q("$.status == ok").value).toBe("ok");
  });

  it("explains what's wrong with a bad query", () => {
    expect(parseJsonQuery("status")).toHaveProperty("error");
    expect(parseJsonQuery("$.")).toHaveProperty("error");
    expect(parseJsonQuery("$.a ~ 3")).toHaveProperty("error");
    expect(parseJsonQuery("$.a ==")).toHaveProperty("error");
  });
});

describe("evaluateJsonQuery", () => {
  it("compares strings, numbers and numeric strings", () => {
    expect(evaluateJsonQuery(q('$.status == "ok"'), data)).toBe(true);
    expect(evaluateJsonQuery(q('$.status != "ok"'), data)).toBe(false);
    expect(evaluateJsonQuery(q("$.queue.depth < 50"), data)).toBe(true);
    expect(evaluateJsonQuery(q("$.queue.depth >= 8"), data)).toBe(false);
    expect(evaluateJsonQuery(q("$.count > 3"), data)).toBe(true);
    expect(evaluateJsonQuery(q("$.count == 12"), data)).toBe(true);
  });

  it("checks presence and truthiness without a comparison", () => {
    expect(evaluateJsonQuery(q("$.healthy"), data)).toBe(true);
    expect(evaluateJsonQuery(q("$.missing"), data)).toBe(false);
    expect(evaluateJsonQuery(q("$.queue.workers[5]"), data)).toBe(false);
  });

  it("fails a numeric comparison on a non-number", () => {
    expect(evaluateJsonQuery(q("$.status < 5"), data)).toBe(false);
  });

  it("doesn't walk into inherited properties", () => {
    expect(evaluateJsonQuery(q("$.constructor"), data)).toBe(false);
  });
});
