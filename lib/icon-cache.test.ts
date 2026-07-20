import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// icon-cache derives its cache dir from CONFIG_DIR, captured at module load —
// so the env var has to be set before the dynamic import (config.test.ts
// pattern). Cross-request state lives on globalThis; tests reset its fields
// (the module holds a reference, so replacing the global wouldn't take).
let cache: typeof import("./icon-cache");
let iconsDir: string;

const g = globalThis as unknown as {
  __ctrlcenterIconCache?: {
    inflight: Map<string, unknown>;
    negativeUntil: Map<string, number>;
    metadata: { text: string; at: number } | null;
    metadataInflight: unknown;
    diskBytes: number | null;
    evictInFlight: unknown;
    lastServed: Map<string, number>;
  };
};

// Small on-disk budget so the eviction tests can exceed it with a handful of
// tiny icons; set before the dynamic import so the module reads it at load.
const CACHE_MAX_BYTES = 4096;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle r="10"/></svg>`;

const okSvg = () =>
  new Response(SVG, { status: 200, headers: { "content-type": "image/svg+xml" } });

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-icons-"));
  process.env.CONFIG_PATH = path.join(dir, "config.yaml");
  process.env.CTRLCENTER_ICON_CACHE_MAX_BYTES = String(CACHE_MAX_BYTES);
  cache = await import("./icon-cache");
  iconsDir = path.join(dir, "icons");
});

beforeEach(async () => {
  const s = g.__ctrlcenterIconCache;
  if (s) {
    s.inflight.clear();
    s.negativeUntil.clear();
    s.metadata = null;
    s.metadataInflight = null;
    s.diskBytes = null;
    s.evictInFlight = null;
    s.lastServed.clear();
  }
  await fs.rm(iconsDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

// Sum the bytes of every cached <slug>.svg on disk.
async function cachedBytes(): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(iconsDir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) {
    if (!name.endsWith(".svg")) continue;
    total += (await fs.stat(path.join(iconsDir, name))).size;
  }
  return total;
}

describe("isCdnIconSlug", () => {
  it("accepts the set's slug shape and rejects everything else", () => {
    expect(cache.isCdnIconSlug("plex")).toBe(true);
    expect(cache.isCdnIconSlug("home-assistant")).toBe(true);
    expect(cache.isCdnIconSlug("2fauth")).toBe(true);
    expect(cache.isCdnIconSlug("")).toBe(false);
    expect(cache.isCdnIconSlug("../etc/passwd")).toBe(false);
    expect(cache.isCdnIconSlug("Plex")).toBe(false);
    expect(cache.isCdnIconSlug("a b")).toBe(false);
    expect(cache.isCdnIconSlug("-leading")).toBe(false);
    expect(cache.isCdnIconSlug("a".repeat(101))).toBe(false);
  });
});

describe("getCdnIcon", () => {
  it("rejects an invalid slug without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIcon("../nope")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once, stores on disk, and serves the cache from then on", async () => {
    const fetchMock = vi.fn(async () => okSvg());
    vi.stubGlobal("fetch", fetchMock);
    const first = await cache.getCdnIcon("plex");
    expect(first && new TextDecoder().decode(first)).toBe(SVG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // On disk under the slug.
    const onDisk = await fs.readFile(path.join(iconsDir, "plex.svg"), "utf8");
    expect(onDisk).toBe(SVG);
    // Second read never refetches.
    const second = await cache.getCdnIcon("plex");
    expect(second && new TextDecoder().decode(second)).toBe(SVG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("negative-caches an upstream 404 instead of refetching per request", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIcon("no-such-icon")).toBeNull();
    expect(await cache.getCdnIcon("no-such-icon")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to cache a body that isn't an SVG document", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html>rate limited</html>", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIcon("plex")).toBeNull();
    await expect(fs.access(path.join(iconsDir, "plex.svg"))).rejects.toBeTruthy();
  });

  it("degrades to null when the CDN is unreachable (offline)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIcon("plex")).toBeNull();
    // Negative-cached: the next render doesn't retry immediately.
    expect(await cache.getCdnIcon("plex")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the negative cache so a flood of distinct bogus slugs can't grow it without limit", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    // Far more distinct failing slugs than the 4096-entry cap.
    for (let i = 0; i < 5000; i++) {
      expect(await cache.getCdnIcon(`missing-${i}`)).toBeNull();
    }
    const negativeUntil = g.__ctrlcenterIconCache!.negativeUntil;
    expect(negativeUntil.size).toBeLessThanOrEqual(4096);
    // The most recent failures are the ones kept (oldest were evicted).
    expect(negativeUntil.has("missing-4999")).toBe(true);
    expect(negativeUntil.has("missing-0")).toBe(false);
  });

  it("deduplicates concurrent requests for the same slug into one fetch", async () => {
    let resolveBody: (() => void) | null = null;
    const gate = new Promise<void>((r) => (resolveBody = r));
    const fetchMock = vi.fn(async () => {
      await gate;
      return okSvg();
    });
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = [cache.getCdnIcon("plex"), cache.getCdnIcon("plex")];
    resolveBody!();
    expect(await a).not.toBeNull();
    expect(await b).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("on-disk cache budget (#183)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Write a cached icon straight to disk with a controlled mtime (the LRU key),
  // bypassing the fetch path so a test can stage a known recency order.
  async function seedIcon(slug: string, mtimeMs: number): Promise<void> {
    await fs.mkdir(iconsDir, { recursive: true });
    const file = path.join(iconsDir, `${slug}.svg`);
    await fs.writeFile(file, SVG);
    const when = new Date(mtimeMs);
    await fs.utimes(file, when, when);
  }

  it("caps total on-disk bytes, evicting to stay within the budget", async () => {
    const fetchMock = vi.fn(async () => okSvg());
    vi.stubGlobal("fetch", fetchMock);
    // Far more distinct icons than the budget holds (SVG is ~90 bytes each).
    for (let i = 0; i < 80; i++) {
      expect(await cache.getCdnIcon(`icon-${i}`)).not.toBeNull();
    }
    const onDisk = await cachedBytes();
    expect(onDisk).toBeLessThanOrEqual(CACHE_MAX_BYTES);
    // The bound actually bit: not every fetched icon is still on disk.
    const remaining = (await fs.readdir(iconsDir)).filter((n) => n.endsWith(".svg"));
    expect(remaining.length).toBeLessThan(80);
    // The running total tracks the real on-disk size.
    expect(g.__ctrlcenterIconCache!.diskBytes).toBe(onDisk);
  });

  it("evicts least-recently-served icons first (oldest mtime)", async () => {
    // Stage enough aged icons to blow the budget, oldest → newest by mtime.
    const base = Date.now() - 1_000_000;
    for (let i = 0; i < 50; i++) await seedIcon(`old-${i}`, base + i * 10_000);
    // A fresh fetch (newest mtime) triggers the over-budget eviction pass.
    vi.stubGlobal("fetch", vi.fn(async () => okSvg()));
    expect(await cache.getCdnIcon("fresh")).not.toBeNull();

    expect(await cachedBytes()).toBeLessThanOrEqual(CACHE_MAX_BYTES);
    // The oldest-served was evicted; the newest-served and the fresh one stayed.
    await expect(fs.access(path.join(iconsDir, "old-0.svg"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(iconsDir, "old-49.svg"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(iconsDir, "fresh.svg"))).resolves.toBeUndefined();
  });

  it("bumps a served icon's mtime, debounced, so LRU counts it as recent", async () => {
    const old = Date.now() - 30 * 24 * 3_600_000; // a month ago
    await seedIcon("plex", old);
    const file = path.join(iconsDir, "plex.svg");
    vi.stubGlobal("fetch", vi.fn()); // a cache hit must not fetch

    // Serving it refreshes the mtime (fire-and-forget utimes).
    expect(await cache.getCdnIcon("plex")).not.toBeNull();
    for (let i = 0; i < 40 && (await fs.stat(file)).mtimeMs <= old; i++) await sleep(5);
    const bumped = (await fs.stat(file)).mtimeMs;
    expect(bumped).toBeGreaterThan(old);

    // A second serve inside the debounce window doesn't rewrite the mtime again.
    expect(await cache.getCdnIcon("plex")).not.toBeNull();
    await sleep(20);
    expect((await fs.stat(file)).mtimeMs).toBe(bumped);
  });
});

describe("getCdnIconMetadata", () => {
  const META = JSON.stringify({ plex: { colors: { light: "plex-light" } } });

  it("fetches once, then serves from memory", async () => {
    const fetchMock = vi.fn(async () => new Response(META, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIconMetadata()).toBe(META);
    expect(await cache.getCdnIconMetadata()).toBe(META);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a body that isn't JSON", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html>err</html>", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIconMetadata()).toBeNull();
  });

  it("serves the stale disk copy when the CDN is unreachable", async () => {
    // Prime a disk copy from a "previous run", aged past the freshness TTL so
    // the module must try the CDN first…
    await fs.mkdir(iconsDir, { recursive: true });
    const file = path.join(iconsDir, "metadata.json");
    await fs.writeFile(file, META, "utf8");
    const old = new Date(Date.now() - 3 * 24 * 3_600_000);
    await fs.utimes(file, old, old);
    // …and the CDN is down.
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await cache.getCdnIconMetadata()).toBe(META);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
