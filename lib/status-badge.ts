// Shields-style SVG status badges (#295): a grey label on the left, a coloured
// value on the right, for READMEs and wikis. Pure, so the layout and escaping
// are unit-tested; the route (/api/status/badge/[id]) picks the text.

export const BADGE_COLORS = {
  up: "#4c1",
  good: "#97ca00",
  fair: "#dfb317",
  poor: "#fe7d37",
  down: "#e05d44",
  maintenance: "#007ec6",
  unknown: "#9f9f9f",
} as const;

// Approximate advance widths for Verdana at 11px, the shields font. Close
// enough to size each half; real renderers differ by a pixel or two.
const NARROW = new Set([..."iljI.,:;'|!() "]);
const SEMI = new Set([..."frt-/"]);
const WIDE: Record<string, number> = { m: 10.7, w: 9, M: 9.9, W: 11, "%": 12 };

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (WIDE[ch] !== undefined) w += WIDE[ch];
    else if (NARROW.has(ch)) w += 3.6;
    else if (SEMI.has(ch)) w += 4.6;
    else if (/[A-Z]/.test(ch)) w += 7.6;
    else w += 6.9;
  }
  return Math.ceil(w);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// The flat shields layout: 20px tall, 5px padding each side of each text.
export function renderBadge(label: string, value: string, color: string): string {
  const lw = textWidth(label) + 10;
  const vw = textWidth(value) + 10;
  const w = lw + vw;
  const l = escapeXml(label);
  const v = escapeXml(value);
  const text = (x: number, t: string) =>
    `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${t}</text><text x="${x}" y="14">${t}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${v}">` +
    `<title>${l}: ${v}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    text(lw / 2, l) +
    text(lw + vw / 2, v) +
    `</g></svg>`
  );
}

export function uptimeColor(pct: number): string {
  if (pct >= 99.5) return BADGE_COLORS.up;
  if (pct >= 99) return BADGE_COLORS.good;
  if (pct >= 95) return BADGE_COLORS.fair;
  if (pct >= 90) return BADGE_COLORS.poor;
  return BADGE_COLORS.down;
}

export function responseColor(ms: number): string {
  if (ms < 300) return BADGE_COLORS.up;
  if (ms < 800) return BADGE_COLORS.fair;
  return BADGE_COLORS.poor;
}

// "100%" for a perfect window, else two decimals ("99.95%"), never rounding
// a real miss up to 100.
export function formatUptime(pct: number): string {
  if (pct >= 100) return "100%";
  return `${(Math.floor(pct * 100) / 100).toFixed(2)}%`;
}
