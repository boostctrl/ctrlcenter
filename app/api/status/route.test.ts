import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { checkApp, checkSignature } from "@/lib/status-check";
import { clearLatestChecks, publishChecks } from "@/lib/status-latest";
import { swrCache } from "@/lib/swr-cache";
import type { AppItem } from "@/lib/schema";

// The public status endpoint (#289): it must never reveal a private app to a
// signed-out caller, and it serves the background poller's latest checks
// rather than probing again (#278). checkApp is stubbed, so nothing touches the network.
vi.mock("@/lib/status-check", async (orig) => ({
  ...(await orig<typeof import("@/lib/status-check")>()),
  checkApp: vi.fn(async () => ({ up: true, status: 200, ms: 12 })),
}));

let GET: typeof import("./route").GET;
let session: string;
// The apps as the route sees them (schema defaults filled in), for signatures.
let configured: AppItem[];

const app = (id: string, isPrivate: boolean) => ({
  id,
  name: id,
  url: `https://${id}.example.com`,
  private: isPrivate,
});

beforeAll(async () => {
  const configPath = await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  await fs.writeFile(
    configPath,
    YAML.dump({
      settings: { statusChecks: true },
      apps: [app("public-app", false), app("private-app", true)],
    }),
    "utf8"
  );
  ({ GET } = await import("./route"));
  configured = (await (await import("@/lib/config")).readConfigInternal()).apps;
  session = await adminSession();
});

beforeEach(() => {
  vi.mocked(checkApp).mockClear();
  // No current checks and no cached probe unless a test sets one up.
  clearLatestChecks();
  swrCache("status-probe", 0).deleteWhere(() => true);
});

// Checks as the poller would publish them, for the apps configured above.
function pollerRound(at: number, ms = 99) {
  publishChecks(
    configured.map((a) => ({
      result: { id: a.id, up: false, status: 503, ms },
      at,
      signature: checkSignature(a),
    })),
    configured.map((a) => a.id)
  );
}

const ids = async (res: Response) =>
  ((await res.json()) as { results: { id: string }[] }).results.map((r) => r.id);

describe("GET /api/status", () => {
  it("shows a signed-out visitor only public apps", async () => {
    const res = await GET(request("/api/status"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await ids(res)).toEqual(["public-app"]);
  });

  it("shows the admin every app, from the same shared cache", async () => {
    expect(await ids(await GET(request("/api/status", { session })))).toEqual([
      "public-app",
      "private-app",
    ]);
  });

  it("serves the poller's current round without probing again", async () => {
    const at = Date.now() - 60_000;
    pollerRound(at);
    const body = await (await GET(request("/api/status", { session }))).json();
    expect(body.checkedAt).toBe(at);
    expect(body.results).toEqual([
      { id: "public-app", up: false, status: 503, ms: 99 },
      { id: "private-app", up: false, status: 503, ms: 99 },
    ]);
    expect(checkApp).not.toHaveBeenCalled();
  });

  it("probes on demand when the poller's round is out of date", async () => {
    // Older than two default (5 min) intervals plus slack: the poller stalled.
    pollerRound(Date.now() - 12 * 60_000);
    const body = await (await GET(request("/api/status", { session }))).json();
    expect(body.results.map((r: { up: boolean }) => r.up)).toEqual([true, true]);
    expect(checkApp).toHaveBeenCalledTimes(2);
    // The probe is cached, so the next caller doesn't fan out again.
    await GET(request("/api/status"));
    expect(checkApp).toHaveBeenCalledTimes(2);
  });

  it("probes only the app the round doesn't describe as configured now", async () => {
    const at = Date.now() - 60_000;
    publishChecks(
      [
        {
          result: { id: "public-app", up: false, status: 503, ms: 99 },
          at,
          signature: checkSignature(configured[0]),
        },
        {
          result: { id: "private-app", up: false, status: 503, ms: 99 },
          at,
          // Checked before its URL was edited.
          signature: checkSignature({ ...configured[1], url: "https://old.example.com" }),
        },
      ],
      configured.map((a) => a.id)
    );
    const body = await (await GET(request("/api/status", { session }))).json();
    expect(checkApp).toHaveBeenCalledTimes(1);
    expect(body.results.map((r: { up: boolean }) => r.up)).toEqual([false, true]);
    expect(body.checkedAt).toBe(at);
  });

  it("judges freshness by each app's own interval (#292)", async () => {
    // 12 minutes old: stale for the global 5-minute interval, current for an
    // app checked every 30 minutes.
    const at = Date.now() - 12 * 60_000;
    const slow = { ...configured[0], interval: 30 };
    publishChecks(
      [
        { result: { id: slow.id, up: false, status: 503, ms: 99 }, at, signature: checkSignature(slow) },
        {
          result: { id: configured[1].id, up: false, status: 503, ms: 99 },
          at,
          signature: checkSignature(configured[1]),
        },
      ],
      configured.map((a) => a.id)
    );
    const configPath = process.env.CONFIG_PATH!;
    const raw = YAML.load(await fs.readFile(configPath, "utf8")) as { apps: Record<string, unknown>[] };
    raw.apps[0].interval = 30;
    await fs.writeFile(configPath, YAML.dump(raw), "utf8");
    try {
      const body = await (await GET(request("/api/status", { session }))).json();
      // Only the 5-minute app is re-probed.
      expect(checkApp).toHaveBeenCalledTimes(1);
      expect(body.results.map((r: { up: boolean }) => r.up)).toEqual([false, true]);
    } finally {
      delete raw.apps[0].interval;
      await fs.writeFile(configPath, YAML.dump(raw), "utf8");
    }
  });

  it("leaves out apps with monitoring off (#296)", async () => {
    const configPath = process.env.CONFIG_PATH!;
    const raw = YAML.load(await fs.readFile(configPath, "utf8")) as { apps: Record<string, unknown>[] };
    raw.apps[1].monitor = false;
    await fs.writeFile(configPath, YAML.dump(raw), "utf8");
    try {
      expect(await ids(await GET(request("/api/status", { session })))).toEqual(["public-app"]);
    } finally {
      delete raw.apps[1].monitor;
      await fs.writeFile(configPath, YAML.dump(raw), "utf8");
    }
  });
});
