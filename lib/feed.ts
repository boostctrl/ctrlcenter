import { readCapped } from "./fetch-body";
import { log, hostOf, errorReason } from "./log";

// Minimal RSS 2.0 / Atom reader for the home-page Feed widget. Hand-rolled (no
// dependency) and deliberately forgiving: it pulls each entry's title, link and
// publish date with tolerant tag matching rather than strict XML parsing, so
// the common real-world feeds work and a malformed one degrades to fewer items
// instead of an error. Item text is decoded to plain strings and rendered as
// React text (never HTML); only http(s) links survive, so a hostile feed can't
// inject markup or javascript: URLs into the dashboard.

export type FeedItem = {
  title: string;
  // Absolute http(s) link, or "" when the entry had none (rendered unlinked).
  url: string;
  // Publish time (epoch ms), or null when missing/unparsable.
  publishedAt: number | null;
};

export type Feed = {
  // The feed's own title ("" when absent); the widget prefers the admin's
  // override.
  title: string;
  items: FeedItem[];
};

// --- Pure parsing helpers (unit-tested) ---

// Decode the XML/HTML entities that actually appear in feed titles. Numeric
// forms go first so an escaped entity like "&amp;#38;" ends up as the literal
// "&#38;" instead of being decoded twice.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// The display text of an XML fragment: CDATA unwrapped, tags stripped,
// entities decoded, whitespace collapsed.
function textContent(fragment: string): string {
  const unwrapped = fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// The inner text of the first <tag>…</tag> in `xml` (any attributes, any
// namespace prefix on the CLOSING match handled by the non-greedy body).
function firstTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "i");
  const m = re.exec(xml);
  return m ? m[1] : null;
}

function httpOnly(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

// An Atom entry's link: prefer rel="alternate" (or no rel), fall back to the
// first link with an href.
function atomLink(entry: string): string {
  const links = [...entry.matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]);
  const hrefOf = (attrs: string): string => {
    const m = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
    return m ? decodeEntities(m[1]) : "";
  };
  const alternate = links.find((attrs) => {
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    return !rel || rel === "alternate";
  });
  return httpOnly(hrefOf(alternate ?? links[0] ?? ""));
}

function parseDate(raw: string | null): number | null {
  if (!raw) return null;
  const t = Date.parse(textContent(raw));
  return Number.isNaN(t) ? null : t;
}

// Parse an RSS 2.0 or Atom document into a Feed. Entries missing a title are
// dropped (there'd be nothing to show); order is preserved (feeds put newest
// first — re-sorting would misorder feeds without dates).
export function parseFeed(xml: string): Feed {
  const entryRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  const items: FeedItem[] = [];
  let firstEntryIndex = xml.length;
  for (const m of xml.matchAll(entryRe)) {
    const at = m.index ?? 0;
    if (at < firstEntryIndex) firstEntryIndex = at;
    const body = m[2];
    const title = textContent(firstTag(body, "title") ?? "");
    if (!title) continue;
    const url =
      m[1].toLowerCase() === "entry"
        ? atomLink(body)
        : httpOnly(textContent(firstTag(body, "link") ?? ""));
    const publishedAt =
      parseDate(firstTag(body, "pubDate")) ??
      parseDate(firstTag(body, "published")) ??
      parseDate(firstTag(body, "updated")) ??
      parseDate(firstTag(body, "dc:date"));
    items.push({ title, url, publishedAt });
  }
  // The feed's own title: the first <title> that appears before any entry
  // (entries have titles too, so position matters).
  const head = xml.slice(0, firstEntryIndex);
  const title = textContent(firstTag(head, "title") ?? "");
  return { title, items };
}

// --- Fetch + cache (server-only) ---

const FEED_TIMEOUT_MS = 6000;
const FEED_CACHE_TTL_MS = 5 * 60_000;
// Cap the fetched body — the fetch is reachable from anonymous home-page loads.
const FEED_MAX_BYTES = 3 * 1024 * 1024;

// Parsed-feed cache keyed by URL, like the calendar's — the homepage is
// force-dynamic, so without it every render would block on the third party.
// Held on globalThis to survive module-graph duplication.
type FeedCacheEntry = { feed: Feed; at: number };
const g = globalThis as unknown as {
  __ctrlcenterFeedCache?: Map<string, FeedCacheEntry>;
};
const feedCache = (g.__ctrlcenterFeedCache ??= new Map());

// GET a URL (time-boxed, size-capped) and parse it as a feed, or say why not.
async function requestFeed(
  target: string
): Promise<{ feed: Feed | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: controller.signal,
    });
    if (!res.ok) return { feed: null, error: `HTTP ${res.status}` };
    const text = await readCapped(res, FEED_MAX_BYTES);
    if (text === null) return { feed: null, error: "Response too large" };
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text))
      return { feed: null, error: "Not an RSS or Atom feed" };
    const feed = parseFeed(text);
    if (feed.items.length === 0)
      return { feed, error: "Feed has no readable entries" };
    return { feed, error: null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    log.warn("feed fetch error", { host: hostOf(target), reason: errorReason(e) });
    return { feed: null, error: aborted ? "Timed out" : "Couldn't connect" };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch + parse a feed, cached for a few minutes; `count` caps the items.
// Returns null for a non-http(s) URL; on a fetch/parse failure serves the last
// good cache if there is one, else null. Never throws.
export async function fetchFeed(url: string, count: number): Promise<Feed | null> {
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) return null;
  const now = Date.now();
  const cached = feedCache.get(target);
  let feed = cached?.feed;
  if (!cached || now - cached.at >= FEED_CACHE_TTL_MS) {
    const { feed: fresh } = await requestFeed(target);
    if (fresh && fresh.items.length > 0) {
      feed = fresh;
      feedCache.set(target, { feed: fresh, at: now });
    }
    // On failure, keep serving the stale cache (feed stays as cached?.feed).
  }
  if (!feed) return null;
  return { ...feed, items: feed.items.slice(0, count) };
}

// Fresh (uncached) reachability check for the admin's "Test feed" button.
export async function probeFeed(
  url: string
): Promise<{ ok: boolean; count: number; title?: string; error?: string }> {
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, count: 0, error: "URL must start with http(s)" };
  }
  const { feed, error } = await requestFeed(target);
  if (!feed || error) return { ok: false, count: 0, error: error ?? "Unreadable feed" };
  return { ok: true, count: feed.items.length, title: feed.title };
}
