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
});
