// Resolves an icon value from config into a renderable image URL.
//
// An icon value is either:
//  - a full URL (http/https) supplied by the user as a custom icon, or
//  - a slug looked up against the dashboard-icons CDN, a large community-
//    maintained set of self-hosted app/service logos (svg).
const ICON_CDN_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg";

// Lightweight index of every available icon slug (the repo's tree.json lists
// the svg filenames). Fetched once and cached for the admin icon browser.
const ICON_TREE_URL =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/tree.json";

// Per-icon metadata; the `colors` field names the variant slugs to use on a
// light or dark background (when an icon ships themed variants), so logos stay
// legible in both themes. Most icons have no variants and just use the base.
const ICON_METADATA_URL =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata.json";

let cachedSlugs: string[] | null = null;

export type IconMetadata = Record<string, { colors?: { light?: string; dark?: string } }>;

let metadataPromise: Promise<IconMetadata> | null = null;

// Fetched once and cached for the lifetime of the page; failures degrade to an
// empty map so icons just use their base (un-themed) variant.
export function loadIconMetadata(): Promise<IconMetadata> {
  if (!metadataPromise) {
    metadataPromise = fetch(ICON_METADATA_URL)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return metadataPromise;
}

export async function fetchIconSlugs(): Promise<string[]> {
  if (cachedSlugs) return cachedSlugs;
  const res = await fetch(ICON_TREE_URL);
  if (!res.ok) throw new Error("Failed to load icon list");
  const tree = await res.json();
  const svg: unknown = tree?.svg;
  const slugs = Array.isArray(svg)
    ? svg
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.replace(/\.svg$/, ""))
        .sort()
    : [];
  cachedSlugs = slugs;
  return slugs;
}

export function isCustomIconUrl(icon: string): boolean {
  return /^https?:\/\//i.test(icon.trim());
}

export function resolveIconUrl(icon: string): string | null {
  const trimmed = icon.trim();
  if (!trimmed) return null;
  if (isCustomIconUrl(trimmed)) return trimmed;
  return `${ICON_CDN_BASE}/${slugify(trimmed)}.svg`;
}

// Like resolveIconUrl, but picks the icon's themed variant for the current
// surface when one exists (custom URLs are returned as-is). In the metadata,
// `colors.dark` is the dark-colored asset (for light backgrounds) and
// `colors.light` is the light-colored asset (for dark backgrounds). Falls back
// to the base icon when there's no themed variant.
export function resolveThemedIconUrl(
  icon: string,
  metadata: IconMetadata,
  surfaceIsLight: boolean
): string | null {
  const trimmed = icon.trim();
  if (!trimmed) return null;
  if (isCustomIconUrl(trimmed)) return trimmed;
  const slug = slugify(trimmed);
  const variant = metadata[slug]?.colors?.[surfaceIsLight ? "dark" : "light"];
  return `${ICON_CDN_BASE}/${variant || slug}.svg`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
