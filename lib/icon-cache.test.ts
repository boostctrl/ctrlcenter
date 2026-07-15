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
  };
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle r="10"/></svg>`;

const okSvg = () =>
  new Response(SVG, { status: 200, headers: { "content-type": "image/svg+xml" } });

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-icons-"));
  process.env.CONFIG_PATH = path.join(dir, "config.yaml");
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
  }
  await fs.rm(iconsDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

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
