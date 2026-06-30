// Web search engine support for the dashboard search bar. Presets supply a URL
// template with a `%s` placeholder; "custom" lets the admin provide their own.
export const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  google: { label: "Google", url: "https://www.google.com/search?q=%s" },
  bing: { label: "Bing", url: "https://www.bing.com/search?q=%s" },
  brave: { label: "Brave", url: "https://search.brave.com/search?q=%s" },
} as const;

export const SEARCH_ENGINE_KEYS = [
  "duckduckgo",
  "google",
  "bing",
  "brave",
  "custom",
] as const;

export type SearchEngine = (typeof SEARCH_ENGINE_KEYS)[number];

// An admin-defined "bang": a `!key` prefix that redirects the query to a `%s`
// URL template (e.g. `!yt cats` → YouTube). Overrides a built-in of the same key.
export type BangConfig = { key: string; url: string };

export type SearchConfig = {
  engine: SearchEngine;
  customUrl: string;
  bangs?: BangConfig[];
};

// A custom URL is only usable if it's an http(s) template containing `%s`.
export function isValidCustomUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim()) && url.includes("%s");
}

export function searchTemplate(search: SearchConfig): string | null {
  if (search.engine === "custom") {
    return isValidCustomUrl(search.customUrl) ? search.customUrl.trim() : null;
  }
  return SEARCH_ENGINES[search.engine]?.url ?? null;
}

export function engineLabel(search: SearchConfig): string {
  return search.engine === "custom"
    ? "the web"
    : (SEARCH_ENGINES[search.engine]?.label ?? "the web");
}

// Builds the final search URL for a query, or null if there's nothing to search
// or the engine isn't usable. The query is URL-encoded; templates are never
// interpolated with raw input.
export function buildSearchUrl(
  search: SearchConfig,
  query: string
): string | null {
  const q = query.trim();
  if (!q) return null;
  const template = searchTemplate(search);
  if (!template) return null;
  return template.replace("%s", encodeURIComponent(q));
}

// --- Bangs: `!key term` shortcuts (DuckDuckGo-style) ---

// Built-in `!key` → search template. Admin custom bangs (settings.search.bangs)
// override these by key; app-name bangs (appBangMap) fill in below them.
export const BUILTIN_BANGS: Record<string, { url: string; label: string }> = {
  g: { url: "https://www.google.com/search?q=%s", label: "Google" },
  ddg: { url: "https://duckduckgo.com/?q=%s", label: "DuckDuckGo" },
  yt: { url: "https://www.youtube.com/results?search_query=%s", label: "YouTube" },
  gh: { url: "https://github.com/search?q=%s&type=repositories", label: "GitHub" },
  w: { url: "https://en.wikipedia.org/w/index.php?search=%s", label: "Wikipedia" },
  maps: { url: "https://www.google.com/maps/search/%s", label: "Google Maps" },
  npm: { url: "https://www.npmjs.com/search?q=%s", label: "npm" },
  so: { url: "https://stackoverflow.com/search?q=%s", label: "Stack Overflow" },
  r: { url: "https://www.reddit.com/search/?q=%s", label: "Reddit" },
  a: { url: "https://www.amazon.com/s?k=%s", label: "Amazon" },
};

// Split a leading `!key` off a query. The key is alphanumeric; the rest (the
// search term, possibly empty) follows. Null when there's no leading bang.
export function parseBang(query: string): { key: string; term: string } | null {
  const m = /^\s*!([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(query);
  if (!m) return null;
  return { key: m[1].toLowerCase(), term: (m[2] ?? "").trim() };
}

// Slug-keyed map of app name → { url, name } for app-name bangs (`!jellyfin`).
// First app wins on a slug collision; apps that slug to nothing are skipped.
export function appBangMap(
  apps: { name: string; url: string }[]
): Record<string, { url: string; name: string }> {
  const out: Record<string, { url: string; name: string }> = {};
  for (const a of apps) {
    const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (slug && !(slug in out)) out[slug] = { url: a.url, name: a.name };
  }
  return out;
}

// What a recognized bang resolves to: the destination URL, a human label for the
// hint, and the term (present only for a template bang actually given a term, so
// the UI can say "Search YouTube for 'cats'" vs "Open YouTube").
export type BangHit = { url: string; label: string; term?: string };

function templateHit(template: string, label: string, term: string): BangHit {
  if (!term) {
    let root = template;
    try {
      root = new URL(template).origin;
    } catch {
      root = template.replace("%s", "");
    }
    return { url: root, label };
  }
  return { url: template.replace("%s", encodeURIComponent(term)), label, term };
}

// Resolve a query's leading bang to its destination, or null when there's no
// leading bang or the key matches nothing. Precedence: admin custom bangs, then
// built-ins, then app-name bangs.
export function resolveBang(
  query: string,
  customBangs: BangConfig[] = [],
  appBangs: Record<string, { url: string; name: string }> = {}
): BangHit | null {
  const parsed = parseBang(query);
  if (!parsed) return null;
  const { key, term } = parsed;
  const custom = customBangs.find((b) => b.key.toLowerCase() === key);
  if (custom) return templateHit(custom.url, custom.key, term);
  const builtin = BUILTIN_BANGS[key];
  if (builtin) return templateHit(builtin.url, builtin.label, term);
  const app = appBangs[key];
  if (app) return { url: app.url, label: app.name };
  return null;
}
