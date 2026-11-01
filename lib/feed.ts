import { readCapped, fetchWithTimeout } from "./fetch-body";
import { log, hostOf, errorReason } from "./log";
import { MAX_FEED_URLS } from "./schema";
import { globalSingleton } from "./singleton";
import { swrCache, type SwrEntry } from "./swr-cache";

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
//
// Everything below scans its input once with indexOf. The regexes it replaced
// backtracked quadratically on crafted input (#393): eighty thousand unclosed
// <item> tags took seconds, and three megabytes would have blocked the event
// loop for minutes, stopping pages, status checks and alerts. The body cap
// bounds bytes, not CPU, so the scanners have to be linear on their own.

// A copy of `s` with only ASCII letters lowercased. It has the same length as
// `s`, so a position found in it maps straight onto `s` (a full toLowerCase can
// change the length of some non-ASCII characters).
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

// A tag's position: where its "<" is, and the index just past its ">".
type Span = [start: number, end: number];

// The next `<tag>` or `<tag …>` start tag at or after `from`, by position in
// the lowercased copy. Null when there isn't a complete one: a start tag with
// no ">" anywhere after it means no later one can have one either.
function openTag(lower: string, tag: string, from: number): Span | null {
  const needle = `<${tag}`;
  for (let i = lower.indexOf(needle, from); i !== -1; i = lower.indexOf(needle, i + 1)) {
    const next = lower.charCodeAt(i + needle.length);
    if (next === 62 /* > */) return [i, i + needle.length + 1];
    if (!isSpace(next)) continue;
    const close = lower.indexOf(">", i + needle.length);
    return close === -1 ? null : [i, close + 1];
  }
  return null;
}

// The next `</tag>` (whitespace allowed before the ">") at or after `from`.
function closeTag(lower: string, tag: string, from: number): Span | null {
  const needle = `</${tag}`;
  for (let i = lower.indexOf(needle, from); i !== -1; i = lower.indexOf(needle, i + 1)) {
    let j = i + needle.length;
    while (isSpace(lower.charCodeAt(j))) j++;
    if (lower.charCodeAt(j) === 62 /* > */) return [i, j + 1];
  }
  return null;
}

// The attribute text of each `<tag …>` start tag in document order (what
// /<tag\b([^>]*)>/gi used to capture), handed to `visit` until it returns
// true. Stops at a start tag with no ">" after it.
function eachStartTag(
  xml: string,
  lower: string,
  tag: string,
  visit: (attrs: string) => boolean | void
): void {
  const needle = `<${tag}`;
  for (let i = lower.indexOf(needle, 0); i !== -1; i = lower.indexOf(needle, i + 1)) {
    if (isWordChar(lower.charCodeAt(i + needle.length))) continue;
    const close = lower.indexOf(">", i + needle.length);
    if (close === -1) return;
    if (visit(xml.slice(i + needle.length, close))) return;
    i = close;
  }
}

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

// Each <![CDATA[ … ]]> replaced by its content; an unterminated one stays as
// it is.
function unwrapCdata(s: string): string {
  const OPEN = "<![CDATA[";
  const CLOSE = "]]>";
  let out = "";
  let pos = 0;
  for (;;) {
    const start = s.indexOf(OPEN, pos);
    if (start === -1) break;
    const end = s.indexOf(CLOSE, start + OPEN.length);
    if (end === -1) break;
    out += s.slice(pos, start) + s.slice(start + OPEN.length, end);
    pos = end + CLOSE.length;
  }
  return pos === 0 ? s : out + s.slice(pos);
}

// Every "<…>" run dropped; a "<" with no ">" after it stays as text.
function stripTags(s: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const lt = s.indexOf("<", pos);
    if (lt === -1) break;
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) break;
    out += s.slice(pos, lt);
    pos = gt + 1;
  }
  return pos === 0 ? s : out + s.slice(pos);
}

// The display text of an XML fragment: CDATA unwrapped, tags stripped,
// entities decoded, whitespace collapsed.
function textContent(fragment: string): string {
  return decodeEntities(stripTags(unwrapCdata(fragment))).replace(/\s+/g, " ").trim();
}

// The inner text of the first <tag>…</tag> in `xml` (any attributes, tag name
// matched case-insensitively), or null. `lower` is asciiLower(xml).
function firstTag(xml: string, lower: string, tag: string): string | null {
  const name = tag.toLowerCase();
  const open = openTag(lower, name, 0);
  if (!open) return null;
  const close = closeTag(lower, name, open[1]);
  return close ? xml.slice(open[1], close[0]) : null;
}

function httpOnly(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function hrefOf(attrs: string): string {
  const m = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
  return m ? decodeEntities(m[1]) : "";
}

// An Atom entry's link: prefer rel="alternate" (or no rel), fall back to the
// first link with an href.
function atomLink(entry: string, entryLower: string): string {
  let first: string | null = null;
  let alternate: string | null = null;
  eachStartTag(entry, entryLower, "link", (attrs) => {
    if (first === null) first = attrs;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!rel || rel === "alternate") {
      alternate = attrs;
      return true;
    }
  });
  return httpOnly(hrefOf(alternate ?? first ?? ""));
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

// How many entries a parse reads before stopping. Feeds run newest-first and
// a card shows at most a couple of dozen items, so the rest of a huge feed is
// never looked at, let alone kept. Exported for the test.
export const MAX_FEED_ENTRIES = 200;

// Parse an RSS 2.0 or Atom document into a Feed. Entries missing a title are
// dropped (there'd be nothing to show); order is preserved (feeds put newest
// first — re-sorting would misorder feeds without dates).
export function parseFeed(xml: string): Feed {
  const lower = asciiLower(xml);
  const items: FeedItem[] = [];
  let firstEntryIndex = xml.length;
  // One forward scan for each entry tag, so a feed of one kind never rescans
  // for the other: the next <item> and <entry> are looked up again only once
  // the parse has moved past them.
  let nextItem = openTag(lower, "item", 0);
  let nextEntry = openTag(lower, "entry", 0);
  let pos = 0;
  let read = 0;
  while (read < MAX_FEED_ENTRIES) {
    if (nextItem && nextItem[0] < pos) nextItem = openTag(lower, "item", pos);
    if (nextEntry && nextEntry[0] < pos) nextEntry = openTag(lower, "entry", pos);
    const isAtom = !nextItem || (nextEntry !== null && nextEntry[0] < nextItem[0]);
    const open = isAtom ? nextEntry : nextItem;
    if (!open) break;
    const tag = isAtom ? "entry" : "item";
    const close = closeTag(lower, tag, open[1]);
    if (!close) {
      // No complete element of this kind remains; the other kind may still
      // have some.
      if (isAtom) nextEntry = null;
      else nextItem = null;
      continue;
    }
    read++;
    if (open[0] < firstEntryIndex) firstEntryIndex = open[0];
    const body = xml.slice(open[1], close[0]);
    const bodyLower = lower.slice(open[1], close[0]);
    pos = close[1];
    const title = textContent(firstTag(body, bodyLower, "title") ?? "");
    if (!title) continue;
    const url = isAtom
      ? atomLink(body, bodyLower)
      : httpOnly(textContent(firstTag(body, bodyLower, "link") ?? ""));
    const publishedAt =
      parseDate(firstTag(body, bodyLower, "pubDate")) ??
      parseDate(firstTag(body, bodyLower, "published")) ??
      parseDate(firstTag(body, bodyLower, "updated")) ??
      parseDate(firstTag(body, bodyLower, "dc:date"));
    // The entry body: <description> (RSS) / <summary>, else <content> (Atom),
    // reduced to clipped plain text by the same textContent pipeline as the
    // title — the no-HTML guarantee holds for summaries too.
    const summary = clipSummary(
      textContent(
        (isAtom
          ? firstTag(body, bodyLower, "summary") ?? firstTag(body, bodyLower, "content")
          : firstTag(body, bodyLower, "description")) ?? ""
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
  const title = textContent(
    firstTag(xml.slice(0, firstEntryIndex), lower.slice(0, firstEntryIndex), "title") ?? ""
  );
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
  const list = Array.isArray(d.items) ? d.items.slice(0, MAX_FEED_ENTRIES) : [];
  for (const raw of list) {
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

// The MIME types a feed autodiscovery <link> advertises.
const FEED_LINK_TYPES = /application\/(rss\+xml|atom\+xml|feed\+json)/i;

// Scan an HTML document for feed autodiscovery links — the rel="alternate"
// <link>s whose type is an RSS / Atom / JSON-feed MIME — and return the feed
// URLs they reference, resolved absolute against the page and limited to
// http(s). Deduped, document order preserved, bounded. Lets the admin paste a
// plain site URL and be offered its actual feed. Exported for unit testing.
export function discoverFeedLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  eachStartTag(html, asciiLower(html), "link", (raw) => {
    // A self-closing tag's "/" is not an attribute.
    const attrs = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const type = /type\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    if (!FEED_LINK_TYPES.test(type)) return;
    // Autodiscovery links are rel="alternate"; tolerate a missing rel but skip
    // an unrelated one (e.g. an Atom service document's rel="edit").
    const rel = /rel\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    if (rel && !/\balternate\b/i.test(rel)) return;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) return;
    let resolved: string;
    try {
      resolved = new URL(decodeEntities(href), baseUrl).href;
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(resolved) || seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
    return out.length >= MAX_FEED_URLS;
  });
  return out;
}

// --- Fetch + cache (server-only) ---

const FEED_TIMEOUT_MS = 6000;
const FEED_CACHE_TTL_MS = 5 * 60_000;
// Cap the fetched body — the fetch is reachable from anonymous home-page loads.
const FEED_MAX_BYTES = 3 * 1024 * 1024;

// Parsed-feed cache keyed by URL, like the calendar's — the homepage is
// force-dynamic, so without it every render would block on the third party.
// Stale-while-revalidate with one in-flight refetch per URL (lib/swr-cache.ts).
// The value keeps the response's ETag / Last-Modified so revalidations can be
// conditional — a 304 just re-arms the TTL without re-downloading the body.
type FeedCacheValue = {
  feed: Feed;
  etag?: string;
  lastModified?: string;
};
// Last fetch outcome per URL — read-only diagnostics for the admin's RSS
// settings ("OK · 12 entries · 3 min ago" / "HTTP 500 · 2 h ago"). Recorded
// by every cache refresh, so it fills in as the home page actually fetches.
export type FeedHealth = {
  ok: boolean;
  // Entry count of the last good parse (present when ok).
  count?: number;
  // Why the last fetch failed (present when not ok).
  error?: string;
  // When the outcome was recorded (epoch ms).
  at: number;
};

const feeds = swrCache<FeedCacheValue>("feed", FEED_CACHE_TTL_MS);
// When a URL's cold load fails, the next render doesn't fetch it again: the
// failure is remembered for a minute (#393), so a feed that is down or
// unreadable costs one download a minute instead of one per page view. Only
// the cold path looks here; a URL with a cached parse refreshes in the
// background anyway.
const FEED_FAILURE_TTL_MS = 60_000;
const feedFailures = globalSingleton(
  "__ctrlcenterFeedFailures",
  () => new Map<string, number>()
);
const feedHealthMap = globalSingleton(
  "__ctrlcenterFeedHealth",
  () => new Map<string, FeedHealth>()
);

// Snapshot of every recorded outcome, keyed by feed URL, for the admin
// health endpoint.
export function getFeedHealth(): Record<string, FeedHealth> {
  return Object.fromEntries(feedHealthMap);
}

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
  // Feed URLs autodiscovered from the body when it was an HTML page, not a
  // feed — used by the admin probe to offer to fill the row.
  discovered?: string[];
};
async function requestFeed(
  target: string,
  validators?: { etag?: string; lastModified?: string }
): Promise<FeedFetchResult> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, */*",
    };
    if (validators?.etag) headers["If-None-Match"] = validators.etag;
    if (validators?.lastModified)
      headers["If-Modified-Since"] = validators.lastModified;
    const res = await fetchWithTimeout(target, { headers }, FEED_TIMEOUT_MS);
    if (res.status === 304)
      return { feed: null, error: null, notModified: true };
    if (!res.ok) return { feed: null, error: `HTTP ${res.status}` };
    const text = await readCapped(res, FEED_MAX_BYTES);
    if (text === null) return { feed: null, error: "Response too large" };
    const feed =
      parseJsonFeed(text) ??
      (/<(rss|feed|rdf:RDF)[\s>]/i.test(text) ? parseFeed(text) : null);
    if (!feed)
      return {
        feed: null,
        error: "Not an RSS, Atom, or JSON feed",
        discovered: discoverFeedLinks(text, target),
      };
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
  }
}

// Revalidate one URL for the cache, recording the outcome in the health map.
// A 304 returns the previous value unchanged, which re-arms its TTL without
// re-downloading or re-parsing the body. Only a good parse replaces the entry —
// a failure returns undefined, so the last good one keeps serving
// (stale-on-failure). Never throws (requestFeed never throws).
async function loadFeed(
  target: string,
  prev: SwrEntry<FeedCacheValue> | undefined
): Promise<FeedCacheValue | undefined> {
  const result = await requestFeed(target, prev?.value);
  const at = Date.now();
  if (result.notModified) {
    if (!prev) return undefined;
    feedFailures.delete(target);
    feedHealthMap.set(target, {
      ok: true,
      count: prev.value.feed.items.length,
      at,
    });
    return prev.value;
  }
  if (result.feed && result.feed.items.length > 0) {
    feedFailures.delete(target);
    feedHealthMap.set(target, { ok: true, count: result.feed.items.length, at });
    return {
      feed: result.feed,
      etag: result.etag,
      lastModified: result.lastModified,
    };
  }
  feedHealthMap.set(target, {
    ok: false,
    error: result.error ?? "Unreadable feed",
    at,
  });
  feedFailures.set(target, at);
  return undefined;
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
  if (!feeds.peek(target)) {
    const failedAt = feedFailures.get(target);
    if (failedAt !== undefined && Date.now() - failedAt < FEED_FAILURE_TTL_MS) return null;
  }
  const feed = (await feeds.get(target, (prev) => loadFeed(target, prev)))
    ?.feed;
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
// When the URL is a web page rather than a feed, `discovered` carries the
// feed URL(s) autodiscovered from its <head>, so the UI can offer to fill the
// row instead of just failing.
export async function probeFeed(url: string): Promise<{
  ok: boolean;
  count: number;
  title?: string;
  error?: string;
  discovered?: string[];
}> {
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, count: 0, error: "URL must start with http(s)" };
  }
  const { feed, error, discovered } = await requestFeed(target);
  if (!feed || error) {
    return {
      ok: false,
      count: 0,
      error:
        discovered && discovered.length > 0
          ? "That's a web page, not a feed — but it links to one"
          : error ?? "Unreadable feed",
      discovered: discovered?.length ? discovered : undefined,
    };
  }
  return { ok: true, count: feed.items.length, title: feed.title };
}
