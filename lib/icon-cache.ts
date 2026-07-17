// Server-side proxy cache for the dashboard-icons CDN set (#128). Slug icons
// used to be fetched from cdn.jsdelivr.net by every visitor's browser at
// render time, so an offline/air-gapped install showed no icons at all and a
// CDN hiccup blanked random tiles. Now the client asks this server
// (/api/icons/cdn/<slug>), which fetches an icon once, stores it beside the
// uploaded icons in the data volume, and serves it locally forever after —
// the dashboard works fully offline for every icon it actually uses.
//
// SSRF posture: the upstream URL is a fixed template on one host; the only
// caller-controlled part is the slug, validated to the CDN set's own shape
// (lowercase alphanumerics and dashes). No redirect following.

import fs from "fs/promises";
import path from "path";
import { CONFIG_DIR } from "./config";
import { log, hostOf, errorReason } from "./log";

// Cached CDN icons live in their own subdir (not uploads/ — an upload's name
// could otherwise collide with a slug) inside the same mounted volume.
const CACHE_DIR = path.join(CONFIG_DIR, "icons");

const CDN_SVG_BASE =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg";
const CDN_METADATA_URL =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata.json";

// Same per-file cap as uploaded icons; metadata.json is one big index and gets
// its own generous bound.
const MAX_CDN_ICON_BYTES = 512 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 5_000;
// How long a failed slug is remembered before the CDN is asked again — keeps
// an offline install (or a typo'd slug on every render) from re-fetching per
// request, while recovering reasonably fast once connectivity returns.
const NEGATIVE_TTL_MS = 5 * 60_000;
// Hard cap on remembered failures. /api/icons/cdn/<slug> is public, and every
// well-formed slug the CDN doesn't have adds a negative-cache entry — so an
// unauthenticated visitor hitting a stream of DISTINCT bogus (but slug-shaped)
// names would otherwise grow this map without bound (memory-exhaustion DoS).
// The cap is far above any real dashboard's distinct-icon count, so bounding
// it only ever bites under that abuse, where evicting the oldest failures is
// the right trade: at worst an evicted bogus slug is re-fetched once.
const MAX_NEGATIVE_ENTRIES = 4096;
// How long a fetched metadata.json is considered fresh; after that the next
// request revalidates it (and keeps serving the stale copy if the CDN is
// unreachable — stale variants beat no variants).
const METADATA_TTL_MS = 24 * 3_600_000;
// Cap on concurrent upstream fetches: a cold icon-picker browse fans out ~120
// tiles at once, and this server shouldn't stampede the CDN (or exhaust its
// own sockets) relaying that.
const MAX_UPSTREAM_FETCHES = 8;

// The dashboard-icons set names files with lowercase alphanumerics and dashes.
// Anything else can't be one of its icons — reject before touching disk or
// network (this is also what keeps the request path traversal-free).
export function isCdnIconSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug);
}

// Cross-request state, on globalThis because Next bundles lib/* per route
// entry (see lib/config.ts): one in-flight map so concurrent requests for a
// slug share a single upstream fetch, one negative cache, one metadata memo,
// and one upstream-fetch semaphore.
type IconCacheState = {
  inflight: Map<string, Promise<Uint8Array | null>>;
  negativeUntil: Map<string, number>;
  metadata: { text: string; at: number } | null;
  metadataInflight: Promise<string | null> | null;
  active: number;
  waiters: (() => void)[];
};
const g = globalThis as unknown as { __ctrlcenterIconCache?: IconCacheState };
const state = (g.__ctrlcenterIconCache ??= {
  inflight: new Map(),
  negativeUntil: new Map(),
  metadata: null,
  metadataInflight: null,
  active: 0,
  // Annotated: a bare [] in the ??= initializer infers never[], poisoning
  // every push through the expression's union type.
  waiters: [] as (() => void)[],
});

// Remember a slug the CDN didn't serve, so the next request degrades instead
// of re-fetching for NEGATIVE_TTL_MS — bounding the map so a flood of distinct
// bogus slugs can't grow it without limit. At the cap, drop already-expired
// entries first (dead weight the hot path ignores anyway); if it's still full
// of live entries, evict oldest-inserted (Map keeps insertion order) until
// under the cap. Re-setting an existing slug keeps its position, which is fine.
function rememberNegative(slug: string): void {
  const now = Date.now();
  if (!state.negativeUntil.has(slug) && state.negativeUntil.size >= MAX_NEGATIVE_ENTRIES) {
    for (const [k, until] of state.negativeUntil) {
      if (until <= now) state.negativeUntil.delete(k);
    }
    while (state.negativeUntil.size >= MAX_NEGATIVE_ENTRIES) {
      const oldest = state.negativeUntil.keys().next().value;
      if (oldest === undefined) break;
      state.negativeUntil.delete(oldest);
    }
  }
  state.negativeUntil.set(slug, now + NEGATIVE_TTL_MS);
}

// Run `fn` holding one of the MAX_UPSTREAM_FETCHES slots; callers past the cap
// queue and are released one per completion.
async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (state.active >= MAX_UPSTREAM_FETCHES) {
    await new Promise<void>((resolve) => {
      state.waiters.push(() => resolve());
    });
  }
  state.active++;
  try {
    return await fn();
  } finally {
    state.active--;
    state.waiters.shift()?.();
  }
}

async function writeFileAtomic(dest: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${dest}.tmp`;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, dest);
}

// Fetch one icon from the CDN, validate it, store it, return its bytes — or
// null (with the slug negative-cached) when the upstream says no or the
// response doesn't look like the SVG it must be.
async function fetchAndStore(slug: string, file: string): Promise<Uint8Array | null> {
  const url = `${CDN_SVG_BASE}/${slug}.svg`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) {
      rememberNegative(slug);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Size + shape sanity: every icon in the set is a small SVG document. A
    // CDN error page or truncated body must not be cached as an icon.
    const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_CDN_ICON_BYTES ||
      !(head.startsWith("<svg") || head.startsWith("<?xml"))
    ) {
      rememberNegative(slug);
      return null;
    }
    await writeFileAtomic(file, bytes);
    return bytes;
  } catch (e) {
    // Network failure (offline, timeout): negative-cache and degrade — the
    // client's letter-avatar fallback takes over.
    rememberNegative(slug);
    log.debug("icon fetch failed", { host: hostOf(url), slug, reason: errorReason(e) });
    return null;
  }
}

// One CDN icon's SVG bytes: from the disk cache when present, fetched-and-
// cached on first use, null when the slug is invalid/unknown or the CDN is
// unreachable with no cached copy.
export async function getCdnIcon(slug: string): Promise<Uint8Array | null> {
  if (!isCdnIconSlug(slug)) return null;
  const file = path.join(CACHE_DIR, `${slug}.svg`);
  try {
    return await fs.readFile(file);
  } catch {
    // Not cached yet.
  }
  if (Date.now() < (state.negativeUntil.get(slug) ?? 0)) return null;
  let pending = state.inflight.get(slug);
  if (!pending) {
    pending = withUpstreamSlot(() => fetchAndStore(slug, file)).finally(() =>
      state.inflight.delete(slug)
    );
    state.inflight.set(slug, pending);
  }
  return pending;
}

const METADATA_FILE = path.join(CACHE_DIR, "metadata.json");

async function fetchMetadata(): Promise<string | null> {
  try {
    const res = await fetch(CDN_METADATA_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length === 0 || text.length > MAX_METADATA_BYTES) return null;
    JSON.parse(text); // must be valid JSON, not an error page
    await writeFileAtomic(METADATA_FILE, text);
    return text;
  } catch (e) {
    log.debug("icon metadata fetch failed", { reason: errorReason(e) });
    return null;
  }
}

// The icon set's metadata.json (theme-variant index) as text: served from
// memory while fresh, revalidated from the CDN after METADATA_TTL_MS, and
// falling back to whatever disk copy exists when the CDN is unreachable —
// null only when there has never been a successful fetch.
export async function getCdnIconMetadata(): Promise<string | null> {
  if (state.metadata && Date.now() - state.metadata.at < METADATA_TTL_MS) {
    return state.metadata.text;
  }
  // A fresh-enough disk copy (from a previous process) avoids refetching on
  // every boot; its mtime is the fetch time.
  try {
    const stat = await fs.stat(METADATA_FILE);
    if (Date.now() - stat.mtimeMs < METADATA_TTL_MS) {
      const text = await fs.readFile(METADATA_FILE, "utf8");
      state.metadata = { text, at: stat.mtimeMs };
      return text;
    }
  } catch {
    // No disk copy yet.
  }
  if (!state.metadataInflight) {
    state.metadataInflight = fetchMetadata().finally(() => {
      state.metadataInflight = null;
    });
  }
  const fetched = await state.metadataInflight;
  if (fetched !== null) {
    state.metadata = { text: fetched, at: Date.now() };
    return fetched;
  }
  // Offline / CDN down: serve the stale disk copy when one exists, and
  // remember it in memory with a short-lived stamp so the next TTL check
  // retries the CDN soon rather than pinning stale data for a day.
  try {
    const text = await fs.readFile(METADATA_FILE, "utf8");
    state.metadata = { text, at: Date.now() - METADATA_TTL_MS + NEGATIVE_TTL_MS };
    return text;
  } catch {
    return null;
  }
}
