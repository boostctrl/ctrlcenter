import { readCapped } from "./fetch-body";
import { log, hostOf, errorReason } from "./log";
import { MAX_FEED_URLS } from "./schema";

// Minimal RSS 2.0 / Atom / JSON Feed reader for the home-page Feed widget.
// Hand-rolled (no dependency) and deliberately forgiving: it pulls each
// entry's title, link and publish date with tolerant tag matching rather than
// strict XML parsing, so the common real-world feeds work and a malformed one
// degrades to fewer items instead of an error. Item text is decoded to plain
// strings and rendered as React text (never HTML); only http(s) links
// survive, so a hostile feed can't inject markup or javascript: URLs into the
// dashboard.

export type FeedItem = {
  title: string;
  // Absolute http(s) link, or "" when the entry had none (rendered unlinked).
  url: string;
  // Publish time (epoch ms), or null when missing/unparsable.
  publishedAt: number | null;
  // A short plain-text snippet of the entry body, clipped server-side to the
  // summary budget. Absent when the entry had no body or the body just
  // repeats the title. Rendered only when the admin turns summaries on.
  summary?: string;
  // The source feed's label (its title, else its host), stamped at merge time so
  // an interleaved multi-feed list stays scannable. Absent on freshly parsed
  // items and when only one feed contributed (the label would be redundant).
  source?: string;
};

export type Feed = {
  // The feed's own title ("" when absent); the widget prefers the admin's
  // override, else the first merged feed's title.
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

// Summaries render as one-to-two-line snippets, so clip the extracted body to
// a character budget here on the server — a full-article body must never ride
// along in the cache or the page. Cut on a word boundary when one is near,
// with an ellipsis marking the cut.
const SUMMARY_MAX_CHARS = 200;
function clipSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  const cut = text.slice(0, SUMMARY_MAX_CHARS + 1);
  const space = cut.lastIndexOf(" ");
  const clipped =
    space > SUMMARY_MAX_CHARS - 40 ? cut.slice(0, space) : cut.slice(0, SUMMARY_MAX_CHARS);
  return `${clipped.trimEnd()}…`;
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
    const isAtom = m[1].toLowerCase() === "entry";
    const url = isAtom
      ? atomLink(body)
      : httpOnly(textContent(firstTag(body, "link") ?? ""));
    const publishedAt =
      parseDate(firstTag(body, "pubDate")) ??
      parseDate(firstTag(body, "published")) ??
      parseDate(firstTag(body, "updated")) ??
      parseDate(firstTag(body, "dc:date"));
    // The entry body: <description> (RSS) / <summary>, else <content> (Atom),
    // reduced to clipped plain text by the same textContent pipeline as the
    // title — the no-HTML guarantee holds for summaries too.
    const summary = clipSummary(
      textContent(
        (isAtom
          ? firstTag(body, "summary") ?? firstTag(body, "content")
          : firstTag(body, "description")) ?? ""
      )
    );
    items.push(
      summary && summary !== title
        ? { title, url, publishedAt, summary }
        : { title, url, publishedAt }
    );
  }
  // The feed's own title: the first <title> that appears before any entry
  // (entries have titles too, so position matters).
  const head = xml.slice(0, firstEntryIndex);
  const title = textContent(firstTag(head, "title") ?? "");
  return { title, items };
}

// Parse a JSON Feed (jsonfeed.org) document into a Feed, or null when the
// body isn't one — no version marker, not JSON, not an object. Items map to
// the same shape and guarantees as the XML path: whitespace-collapsed plain
// titles (JSON Feed titles are plain text by spec — no entity decoding, so a
// literal "&amp;" stays as written), http(s)-only links, entries without a
// title dropped. Exported for unit testing.
export function parseJsonFeed(body: string): Feed | null {
  if (!body.trimStart().startsWith("{")) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const d = doc as { version?: unknown; title?: unknown; items?: unknown };
  if (
    typeof d.version !== "string" ||
    !d.version.startsWith("https://jsonfeed.org/version/")
  ) {
    return null;
  }
  const plain = (v: unknown): string =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  const items: FeedItem[] = [];
  for (const raw of Array.isArray(d.items) ? d.items : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as {
      title?: unknown;
      url?: unknown;
      date_published?: unknown;
      summary?: unknown;
      content_text?: unknown;
      content_html?: unknown;
    };
    const title = plain(it.title);
    if (!title) continue;
    const url = typeof it.url === "string" ? httpOnly(it.url) : "";
    const t =
      typeof it.date_published === "string" ? Date.parse(it.date_published) : NaN;
    const publishedAt = Number.isNaN(t) ? null : t;
    // The entry body: summary, else content_text (both plain by spec), else
    // content_html stripped to text through the XML path's pipeline.
    const summary = clipSummary(
      plain(it.summary) ||
        plain(it.content_text) ||
        (typeof it.content_html === "string" ? textContent(it.content_html) : "")
    );
    items.push(
      summary && summary !== title
        ? { title, url, publishedAt, summary }
        : { title, url, publishedAt }
    );
  }
  return { title: plain(d.title), items };
}

// --- Fetch + cache (server-only) ---

const FEED_TIMEOUT_MS = 6000;
const FEED_CACHE_TTL_MS = 5 * 60_000;
// Cap the fetched body — the fetch is reachable from anonymous home-page loads.
const FEED_MAX_BYTES = 3 * 1024 * 1024;

// Parsed-feed cache keyed by URL, like the calendar's — the homepage is
// force-dynamic, so without it every render would block on the third party.
// Held on globalThis to survive module-graph duplication, as is the in-flight
// refresh map that keeps concurrent renders from stacking duplicate fetches.
// The entry keeps the response's ETag / Last-Modified so revalidations can be
// conditional — a 304 just re-arms the TTL without re-downloading the body.
type FeedCacheEntry = {
  feed: Feed;
  at: number;
  etag?: string;
  lastModified?: string;
};
const g = globalThis as unknown as {
  __ctrlcenterFeedCache?: Map<string, FeedCacheEntry>;
  __ctrlcenterFeedRefresh?: Map<string, Promise<void>>;
};
const feedCache = (g.__ctrlcenterFeedCache ??= new Map());
const refreshInFlight = (g.__ctrlcenterFeedRefresh ??= new Map());

// GET a URL (time-boxed, size-capped) and parse it as a feed, or say why not.
// When the caller has cached validators the request is conditional
// (If-None-Match / If-Modified-Since) and an unchanged body comes back as
// `notModified` with no feed — the caller keeps its parse. A fresh body's own
// ETag / Last-Modified ride along for the next revalidation.
type FeedFetchResult = {
  feed: Feed | null;
  error: string | null;
  notModified?: boolean;
  etag?: string;
  lastModified?: string;
};
async function requestFeed(
  target: string,
  validators?: { etag?: string; lastModified?: string }
): Promise<FeedFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, */*",
    };
    if (validators?.etag) headers["If-None-Match"] = validators.etag;
    if (validators?.lastModified)
      headers["If-Modified-Since"] = validators.lastModified;
    const res = await fetch(target, { headers, signal: controller.signal });
    if (res.status === 304)
      return { feed: null, error: null, notModified: true };
    if (!res.ok) return { feed: null, error: `HTTP ${res.status}` };
    const text = await readCapped(res, FEED_MAX_BYTES);
    if (text === null) return { feed: null, error: "Response too large" };
    const feed =
      parseJsonFeed(text) ??
      (/<(rss|feed|rdf:RDF)[\s>]/i.test(text) ? parseFeed(text) : null);
    if (!feed)
      return { feed: null, error: "Not an RSS, Atom, or JSON feed" };
    if (feed.items.length === 0)
      return { feed, error: "Feed has no readable entries" };
    return {
      feed,
      error: null,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    log.warn("feed fetch error", { host: hostOf(target), reason: errorReason(e) });
    return { feed: null, error: aborted ? "Timed out" : "Couldn't connect" };
  } finally {
    clearTimeout(timer);
  }
}

// Refresh one URL's cache entry, deduped so at most one fetch per URL is in
// flight however many renders want it. Revalidations are conditional: a 304
// re-arms the existing entry's TTL without re-downloading or re-parsing the
// body. Only a good parse replaces the entry — a failure keeps serving the
// last good cache (stale-on-failure). Never rejects (requestFeed never
// throws), so a fire-and-forget call can't become an unhandled rejection.
function refreshFeed(target: string): Promise<void> {
  const inFlight = refreshInFlight.get(target);
  if (inFlight) return inFlight;
  const run = (async () => {
    try {
      const result = await requestFeed(target, feedCache.get(target));
      if (result.notModified) {
        const entry = feedCache.get(target);
        if (entry) feedCache.set(target, { ...entry, at: Date.now() });
      } else if (result.feed && result.feed.items.length > 0) {
        feedCache.set(target, {
          feed: result.feed,
          at: Date.now(),
          etag: result.etag,
          lastModified: result.lastModified,
        });
      }
    } finally {
      refreshInFlight.delete(target);
    }
  })();
  refreshInFlight.set(target, run);
  return run;
}

// Fetch + parse one feed, cached for a few minutes; `cap` limits the items so a
// single feed can't crowd out the others in the merge. Stale-while-revalidate:
// an existing cache entry — even an expired one — is served immediately, with
// the refetch running behind the response; only a cold cache blocks the
// render on the network. Returns null for a non-http(s) URL or when nothing
// has ever resolved. Never throws.
async function fetchOneFeed(url: string, cap: number): Promise<Feed | null> {
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) return null;
  const cached = feedCache.get(target);
  if (!cached) {
    await refreshFeed(target);
  } else if (Date.now() - cached.at >= FEED_CACHE_TTL_MS) {
    void refreshFeed(target);
  }
  const feed = (feedCache.get(target) ?? cached)?.feed;
  if (!feed) return null;
  return { ...feed, items: feed.items.slice(0, cap) };
}

// Merge several parsed feeds into one list, newest-first. Dated items sort by
// publish time descending; an undated item inherits the timestamp of the most
// recent dated item above it in ITS OWN feed (feeds run newest-first), so it
// stays beside its neighbours instead of being dumped at the end. A stable sort
// keeps ties in feed-then-document order. Items sharing a URL (the same story
// carried by overlapping sources) keep only their highest-ranked occurrence —
// deduped after the sort so rank decides, and before the cap so a dropped
// duplicate doesn't shortchange the list; "" is not an identity, so unlinked
// items are exempt. Each item is stamped with its source feed's label only
// when more than one feed contributed, so a single feed shows no redundant
// labels. `count` caps the result; the title falls back to the first feed's
// own title. Exported for unit testing the interleave.
export function mergeFeeds(
  sources: { feed: Feed; source: string }[],
  count: number
): Feed {
  const label = sources.length > 1;
  type Tagged = { item: FeedItem; effective: number; order: number };
  const tagged: Tagged[] = [];
  let order = 0;
  for (const { feed, source } of sources) {
    // Undated items before any dated one in a newest-first feed seed from the
    // feed's newest dated item, so they rank near their own feed's top rather
    // than jumping ahead of every other feed's real dates. A feed with NO dates
    // at all seeds at -∞, sinking below every dated item (in feed-then-document
    // order) instead of floating to the very top of the merged list.
    let inherited =
      feed.items.find((i) => i.publishedAt !== null)?.publishedAt ??
      Number.NEGATIVE_INFINITY;
    for (const item of feed.items) {
      if (item.publishedAt !== null) inherited = item.publishedAt;
      tagged.push({
        item: label ? { ...item, source } : item,
        effective: inherited,
        order: order++,
      });
    }
  }
  tagged.sort((a, b) =>
    a.effective === b.effective ? a.order - b.order : b.effective - a.effective
  );
  const seen = new Set<string>();
  const deduped = tagged.filter(({ item }) => {
    if (item.url === "") return true;
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  return {
    title: sources[0]?.feed.title ?? "",
    items: deduped.slice(0, count).map((t) => t.item),
  };
}

// Fetch every configured feed URL concurrently and merge them newest-first.
// One slow or dead feed degrades to nothing from that feed rather than emptying
// the widget or delaying the page (each fetch is independently time-boxed and
// cached). `count` caps the merged list. Returns null when no URL is usable or
// none resolved. Never throws.
export async function fetchFeeds(
  urls: string[],
  count: number
): Promise<Feed | null> {
  const targets = urls
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
    // Bound the fan-out even if a hand-edited or imported config exceeds the
    // admin-path cap: the widget must never become an unbounded per-render
    // source of outbound requests.
    .slice(0, MAX_FEED_URLS);
  if (targets.length === 0) return null;
  const results = await Promise.all(
    targets.map(async (u) => {
      const feed = await fetchOneFeed(u, count);
      return feed ? { feed, source: feed.title.trim() || hostOf(u) } : null;
    })
  );
  const resolved = results.filter(
    (r): r is { feed: Feed; source: string } => r !== null
  );
  if (resolved.length === 0) return null;
  return mergeFeeds(resolved, count);
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
