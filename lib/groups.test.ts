import { describe, it, expect } from "vitest";
import { allTags, appMatches, findGroupByName, groupBookmarks, groupName, groupUsage } from "./groups";
import { appItemSchema, bookmarkItemSchema } from "./schema";

// Groups and filters (#299).
const groups = [
  { id: "media", name: "Media" },
  { id: "dev", name: "Dev" },
];
const app = (over: Record<string, unknown>) =>
  appItemSchema.parse({ id: "a", name: "A", url: "https://a.com", ...over });
const bm = (id: string, group: string) => bookmarkItemSchema.parse({ id, group, name: id, url: "https://x.com" });

describe("group lookups", () => {
  it("names a group, an unknown id and none", () => {
    expect(groupName(groups, "dev")).toBe("Dev");
    expect(groupName(groups, "gone")).toBe("gone");
    expect(groupName(groups, "")).toBe("Other");
  });

  it("finds a group by name in any case, ignoring spaces", () => {
    expect(findGroupByName(groups, "  media ")?.id).toBe("media");
    expect(findGroupByName(groups, "")).toBeUndefined();
  });
});

describe("groupBookmarks", () => {
  it("orders groups by the list, then unknown ones first-seen, keeping item order", () => {
    const out = groupBookmarks([bm("1", "x"), bm("2", "dev"), bm("3", "media"), bm("4", "dev")], groups);
    expect(out.map((g) => [g.id, g.name, g.items.map((i) => i.id)])).toEqual([
      ["media", "Media", ["3"]],
      ["dev", "Dev", ["2", "4"]],
      ["x", "x", ["1"]],
    ]);
  });
});

describe("appMatches", () => {
  const any = { group: "", tag: "", private: "any" as const };
  it("filters by group, tag (any case) and privacy", () => {
    const a = app({ group: "media", tags: ["Video"], private: true });
    expect(appMatches(a, any)).toBe(true);
    expect(appMatches(a, { ...any, group: "dev" })).toBe(false);
    expect(appMatches(a, { ...any, tag: "video" })).toBe(true);
    expect(appMatches(a, { ...any, tag: "audio" })).toBe(false);
    expect(appMatches(a, { ...any, private: "hide" })).toBe(false);
    expect(appMatches(a, { ...any, private: "only" })).toBe(true);
    expect(appMatches(app({}), { ...any, private: "only" })).toBe(false);
  });
});

describe("tags and usage", () => {
  it("lists tags once, first-seen", () => {
    expect(allTags([app({ tags: ["b", "A"] }), app({ tags: ["a", "c"] })])).toEqual(["b", "A", "c"]);
  });

  it("counts apps and bookmarks per group", () => {
    const usage = groupUsage([app({ group: "dev" }), app({})], [bm("1", "dev"), bm("2", "media")]);
    expect(usage.get("dev")).toEqual({ apps: 1, bookmarks: 1 });
    expect(usage.get("media")).toEqual({ apps: 0, bookmarks: 1 });
    expect(usage.has("")).toBe(false);
  });
});
