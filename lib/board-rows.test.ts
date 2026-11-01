import { describe, it, expect } from "vitest";
import { rowsFor } from "./board-rows";
import { resolveLayout } from "./layout";
import { widgetInstanceSchema, type Config } from "./schema";

// The rows a board shows a visitor, a member and an admin (#299, #451): the
// layout a 2.x install gets from the 3.0 upgrade, an apps widget hiding
// private apps beside a "Private Applications" one showing only them.
const instances: Config["widgets"] = [
  widgetInstanceSchema.parse({ id: "greeting", type: "greeting" }),
  widgetInstanceSchema.parse({ id: "apps", type: "apps", filter: { private: "hide" } }),
  widgetInstanceSchema.parse({ id: "apps-private", type: "apps", title: "Private Applications", filter: { private: "only" } }),
  widgetInstanceSchema.parse({ id: "health", type: "api", visibility: "admin" }),
];
const sections = [
  { widget: "greeting", span: 24 },
  { widget: "apps", span: 24 },
  { widget: "apps-private", span: 24 },
  { widget: "health", span: 24, hidden: true },
];
const resolved = resolveLayout(sections, instances);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("rowsFor", () => {
  it("keeps the private-only apps widget off a visitor's page, who has no private app", () => {
    expect(ids(rowsFor(resolved, instances, [{ private: false }], false))).toEqual(["greeting", "apps"]);
  });

  it("shows it to a member with a private app shared with them (#451)", () => {
    expect(ids(rowsFor(resolved, instances, [{ private: false }, { private: true }], false))).toEqual([
      "greeting",
      "apps",
      "apps-private",
    ]);
  });

  it("still withholds it from a member with no private app shared", () => {
    expect(ids(rowsFor(resolved, instances, [{ private: false }], false))).not.toContain("apps-private");
  });

  it("drops hidden rows and admin-only widgets for everyone but an admin, who gets every row", () => {
    expect(ids(rowsFor(resolved, instances, [{ private: true }], false))).not.toContain("health");
    expect(ids(rowsFor(resolved, instances, [], true))).toEqual(["greeting", "apps", "apps-private", "health"]);
  });
});
