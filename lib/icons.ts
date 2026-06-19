// Resolves an icon value from config into a renderable image URL.
//
// An icon value is either:
//  - a full URL (http/https) supplied by the user as a custom icon, or
//  - a slug looked up against the dashboard-icons CDN, a large community-
//    maintained set of self-hosted app/service logos (svg).
const ICON_CDN_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg";

export function isCustomIconUrl(icon: string): boolean {
  return /^https?:\/\//i.test(icon.trim());
}

export function resolveIconUrl(icon: string): string | null {
  const trimmed = icon.trim();
  if (!trimmed) return null;
  if (isCustomIconUrl(trimmed)) return trimmed;
  return `${ICON_CDN_BASE}/${slugify(trimmed)}.svg`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
