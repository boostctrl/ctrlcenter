import { describe, it, expect } from "vitest";
import { instanceLabels } from "./labels";
import { newInstance } from "../schema";

describe("instanceLabels (#297)", () => {
  it("uses the instance's title, else the type's label, numbering repeats", () => {
    const labels = instanceLabels([
      newInstance("notes", "n1"),
      { ...newInstance("notes", "n2"), title: "" },
      { ...newInstance("notes", "n3"), title: "Shopping" },
      newInstance("apps", "apps"),
      newInstance("feed", "f1"),
    ]);
    expect(labels).toEqual({
      n1: "Notes",
      n2: "Notes 2",
      n3: "Shopping",
      apps: "Applications",
      f1: "RSS feed",
    });
  });

  it("numbers the second and later of a shared label", () => {
    const labels = instanceLabels([
      { ...newInstance("notes", "a"), title: "Todo" },
      { ...newInstance("notes", "b"), title: "Todo" },
      { ...newInstance("countdown", "c"), title: "Todo" },
    ]);
    expect(labels).toEqual({ a: "Todo", b: "Todo 2", c: "Todo 3" });
  });

  // #484: numbering repeats of "Notes" gave the second one "Notes 2", the
  // title a third instance already had.
  it("skips a number another instance's title already has", () => {
    const labels = instanceLabels([
      { ...newInstance("notes", "a"), title: "Notes" },
      { ...newInstance("notes", "b"), title: "Notes" },
      { ...newInstance("notes", "c"), title: "Notes 2" },
      newInstance("notes", "d"),
    ]);
    expect(labels).toEqual({ a: "Notes", b: "Notes 3", c: "Notes 2", d: "Notes 4" });
    expect(new Set(Object.values(labels)).size).toBe(4);
  });

  it("skips a number an earlier numbered label already has", () => {
    const labels = instanceLabels([
      { ...newInstance("notes", "a"), title: "Notes 2" },
      { ...newInstance("notes", "b"), title: "Notes 2" },
      { ...newInstance("notes", "c"), title: "Notes 2 2" },
      { ...newInstance("notes", "d"), title: "Notes 2 2" },
    ]);
    expect(new Set(Object.values(labels)).size).toBe(4);
  });
});
