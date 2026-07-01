// The home-page dashboard sections the admin can reorder and size. This controls
// order and column width only — visibility still comes from settings.components,
// and the header (greeting/clock/weather/status) is fixed and not included here.

export const LAYOUT_SECTION_IDS = [
  "search",
  "calendar",
  "favorites",
  "apps",
  "bookmarks",
] as const;

export type LayoutSectionId = (typeof LAYOUT_SECTION_IDS)[number];
export type SectionWidth = "full" | "half";
export type LayoutSection = { id: LayoutSectionId; width: SectionWidth };

export const SECTION_LABELS: Record<LayoutSectionId, string> = {
  search: "Search",
  calendar: "Calendar",
  favorites: "Favorites",
  apps: "Applications",
  bookmarks: "Bookmarks",
};

function isSectionId(v: unknown): v is LayoutSectionId {
  return typeof v === "string" && (LAYOUT_SECTION_IDS as readonly string[]).includes(v);
}

// Normalize a stored/partial layout into a concrete, complete section list: keep
// the saved order, drop unknown ids and duplicates, coerce a bad width to
// "full", then append any known section the saved layout is missing (in
// canonical order, full width). This keeps rendering resilient to a hand-edited
// config and guarantees a section added in a future version still shows even
// when an older saved layout predates it. Mirrors applyOrder in lib/config.ts.
export function resolveLayoutSections(
  sections: readonly Partial<LayoutSection>[] | undefined
): LayoutSection[] {
  const out: LayoutSection[] = [];
  const seen = new Set<LayoutSectionId>();
  for (const s of sections ?? []) {
    const id = s?.id;
    if (!isSectionId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, width: s?.width === "half" ? "half" : "full" });
  }
  for (const id of LAYOUT_SECTION_IDS) {
    if (!seen.has(id)) out.push({ id, width: "full" });
  }
  return out;
}
