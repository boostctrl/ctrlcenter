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

export type SearchConfig = { engine: SearchEngine; customUrl: string };

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
