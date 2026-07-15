// One-time migration of pre-2.0 config shapes (#152). Everything the 1.x line
// accepted but 2.0 no longer stores lives here, applied structurally to the
// raw YAML object BEFORE zod parses it — the schemas themselves only know the
// current shape. readConfigInternal (lib/config.ts) runs this on every read
// and persists the rewrite once (after snapshotting the original file to
// config.yaml.bak); replaceConfig runs it on imported files so a pre-2.0
// backup stays restorable.
//
// The rewrite is deliberately surgical: only the legacy keys below are
// touched, and nothing is laundered through the schemas — unknown keys and
// rows the lenient read would drop stay in the file byte-for-byte. An
// unprompted background rewrite must never destroy data an admin didn't ask
// to change.
//
// Ledger of what migrates (each entry names the release that deprecated it):
// - settings.feed.url            → folded into feed.urls   (deprecated 1.9.6, #107)
// - layout spans on the 12-grid  → doubled onto 24 columns (superseded 1.3)
// - layout section `width` enum  → mapped to a 24-col span (superseded 1.3)
// - layout section `spaceBelow`  → moved to `space.bottom` (superseded 1.8.1)
// The deprecated d7 status windows (#117) are API payload, not config — they
// were removed from lib/status.ts outright with no migration to run.

import { GRID_COLUMNS, MAX_WIDGET_SPACE } from "./layout";

// The 1.3 grid was 12 columns; spans saved against it double onto today's 24.
// A `columns` marker on the persisted layout says which grid the spans were
// saved against (absent = 12).
const LEGACY_GRID_COLUMNS = 12;

// Pre-1.3 section widths (the old 6-column grid) and their 24-column spans.
const WIDTH_TO_SPAN: Record<string, number> = {
  full: 24,
  twoThirds: 16,
  half: 12,
  third: 8,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSpan(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= GRID_COLUMNS
  );
}

// One side's spacing value, mirroring the schema's bounds.
function isSpaceValue(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_WIDGET_SPACE
  );
}

// Whether a row's `space` object carries at least one valid side — the same
// test the old schema fold used to decide that `space` wins over `spaceBelow`.
function hasValidSpace(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return ["top", "right", "bottom", "left"].some((side) => isSpaceValue(v[side]));
}

// Fold the deprecated single feed `url` into the `urls` list. The url only
// survives into `urls` while that list has no usable entry (matching the old
// feedUrls() fallback); either way the legacy key comes off the object — every
// 1.9.x write stamped `url: ""` onto the file, so key presence alone marks a
// pre-2.0 config.
function migrateFeed(settings: Record<string, unknown>): boolean {
  const feed = settings.feed;
  if (!isRecord(feed) || !("url" in feed)) return false;
  const { url, urls } = feed;
  const hasUrls =
    Array.isArray(urls) && urls.some((u) => typeof u === "string" && u.trim() !== "");
  const next: Record<string, unknown> = { ...feed };
  delete next.url;
  if (!hasUrls && typeof url === "string" && url.trim() !== "") {
    next.urls = [url];
  }
  settings.feed = next;
  return true;
}

// Double spans saved against the 12-column grid onto today's 24 and stamp the
// `columns` marker. Runs BEFORE the width fold below: widths map straight to
// 24-based spans and must not be doubled. Only plausible 12-based spans are
// touched — anything else is left for the schema's validation, exactly as the
// old parse-time preprocess behaved.
function migrateLayoutColumns(layout: Record<string, unknown>): boolean {
  if (layout.columns === GRID_COLUMNS || !Array.isArray(layout.sections)) {
    return false;
  }
  layout.sections = layout.sections.map((row) => {
    if (!isRecord(row)) return row;
    const span = row.span;
    return typeof span === "number" &&
      Number.isInteger(span) &&
      span >= 1 &&
      span <= LEGACY_GRID_COLUMNS
      ? { ...row, span: span * 2 }
      : row;
  });
  layout.columns = GRID_COLUMNS;
  return true;
}

// Rewrite one layout section row: map a legacy `width` to its span (a valid
// explicit span wins) and move a legacy `spaceBelow` into `space.bottom` (a
// `space` object with any valid side wins whole). Both keys come off the row
// regardless, so their presence alone marks the row as changed.
function migrateSectionRow(row: Record<string, unknown>): {
  row: Record<string, unknown>;
  changed: boolean;
} {
  let changed = false;
  let next = row;
  if ("width" in next) {
    const { width, ...rest } = next;
    const mapped =
      typeof width === "string" && Object.hasOwn(WIDTH_TO_SPAN, width)
        ? WIDTH_TO_SPAN[width]
        : undefined;
    if (!isSpan(rest.span) && mapped !== undefined) {
      rest.span = mapped;
    }
    next = rest;
    changed = true;
  }
  if ("spaceBelow" in next) {
    const { spaceBelow, ...rest } = next;
    if (!hasValidSpace(rest.space) && isSpaceValue(spaceBelow)) {
      rest.space = { bottom: spaceBelow };
    }
    next = rest;
    changed = true;
  }
  return { row: next, changed };
}

// Migrate every pre-2.0 shape in a raw (pre-zod) config object. Pure and
// idempotent: the input is never mutated, a second pass over the output
// reports `changed: false`, and everything that isn't a legacy key — unknown
// fields, malformed rows the lenient read would drop — is carried through
// untouched.
export function migrateConfigShape(raw: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (!isRecord(raw) || !isRecord(raw.settings)) {
    return { value: raw, changed: false };
  }
  let changed = false;
  const settings = { ...raw.settings };

  if (migrateFeed(settings)) changed = true;

  if (isRecord(settings.layout)) {
    const layout = { ...settings.layout };
    let layoutChanged = migrateLayoutColumns(layout);
    if (Array.isArray(layout.sections)) {
      const sections = layout.sections.map((row) => {
        if (!isRecord(row)) return row;
        const result = migrateSectionRow(row);
        if (result.changed) layoutChanged = true;
        return result.row;
      });
      if (layoutChanged) layout.sections = sections;
    }
    if (layoutChanged) {
      settings.layout = layout;
      changed = true;
    }
  }

  return changed ? { value: { ...raw, settings }, changed } : { value: raw, changed };
}
