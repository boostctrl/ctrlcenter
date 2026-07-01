import { describe, it, expect } from "vitest";
import {
  resolveLayoutSections,
  LAYOUT_SECTION_IDS,
  type LayoutSection,
  type LayoutSectionId,
  type SectionWidth,
} from "./layout";
import { settingsSchema, layoutSchema } from "./schema";

const allFull = () =>
  LAYOUT_SECTION_IDS.map((id) => ({ id, width: "full" }));

describe("resolveLayoutSections", () => {
  it("defaults to all sections full, in canonical order, for empty/undefined", () => {
    expect(resolveLayoutSections(undefined)).toEqual(allFull());
    expect(resolveLayoutSections([])).toEqual(allFull());
  });

  it("keeps saved order and width, and appends any missing section as full", () => {
    const saved: LayoutSection[] = [
      { id: "bookmarks", width: "half" },
      { id: "apps", width: "half" },
    ];
    const out = resolveLayoutSections(saved);
    expect(out.slice(0, 2)).toEqual(saved);
    expect(out.slice(2).map((s) => s.id)).toEqual([
      "search",
      "calendar",
      "favorites",
    ]);
    expect(out.slice(2).every((s) => s.width === "full")).toBe(true);
    // Every section appears exactly once.
    expect(out.map((s) => s.id).sort()).toEqual([...LAYOUT_SECTION_IDS].sort());
  });

  it("drops unknown ids and duplicates, and coerces a bad width to full", () => {
    const out = resolveLayoutSections([
      { id: "apps", width: "half" },
      { id: "apps", width: "full" }, // duplicate id — ignored (first wins)
      { id: "nope" as LayoutSectionId, width: "half" }, // unknown — dropped
      { id: "search", width: "wide" as SectionWidth }, // bad width — full
    ]);
    expect(out.find((s) => s.id === "apps")?.width).toBe("half");
    expect(out.find((s) => s.id === "search")?.width).toBe("full");
    expect(out.some((s) => (s.id as string) === "nope")).toBe(false);
    expect(out).toHaveLength(LAYOUT_SECTION_IDS.length);
  });

  it("preserves the third and two-thirds widths", () => {
    const out = resolveLayoutSections([
      { id: "apps", width: "twoThirds" },
      { id: "calendar", width: "third" },
    ]);
    expect(out.find((s) => s.id === "apps")?.width).toBe("twoThirds");
    expect(out.find((s) => s.id === "calendar")?.width).toBe("third");
  });
});

describe("layout schema", () => {
  it("settingsSchema defaults to the 5 sections, all full, in order", () => {
    expect(settingsSchema.parse({}).layout.sections).toEqual(allFull());
  });

  it("recovers from a malformed section list instead of failing to parse", () => {
    // A bad row makes the array catch to [] (so the config still loads); the
    // resolver then rebuilds the default arrangement.
    const parsed = layoutSchema.parse({ sections: [{ id: "not-a-section" }] });
    expect(resolveLayoutSections(parsed.sections)).toEqual(allFull());
  });
});
