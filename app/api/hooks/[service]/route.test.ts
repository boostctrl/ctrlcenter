import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, params } from "@/lib/testing/routes";
import { pendingWebhookDigests, resetWebhookDigest } from "@/lib/webhook-digest";

// Inbound webhooks (#204, #289): a public route gated only by its token. One
// webhook channel is seeded so a relayed event has somewhere to go, and the
// burst window is on (#346) so an episode import is held while a Test is not.
let POST: typeof import("./route").POST;

beforeAll(async () => {
  const configPath = await useScratchConfig();
  await fs.writeFile(
    configPath,
    YAML.dump({
      settings: {
        alerts: { channels: [{ id: "c1", type: "webhook", url: "https://hook.test" }] },
        webhooks: { enabled: true, digestSeconds: 60, sonarr: { enabled: true, token: "s3cret-token" } },
      },
    }),
    "utf8"
  );
  ({ POST } = await import("./route"));
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  resetWebhookDigest();
  vi.unstubAllGlobals();
});

const hook = (service: string, token: string, body: unknown = { eventType: "Test" }) =>
  POST(
    request(`/api/hooks/${service}?token=${token}`, {
      method: "POST",
      body,
      headers: { "sec-fetch-site": "cross-site", "x-forwarded-for": "203.0.113.9" },
    }),
    params({ service })
  );

describe("POST /api/hooks/[service]", () => {
  it("404s a service that doesn't exist", async () => {
    expect((await hook("plex", "x")).status).toBe(404);
  });

  it("gives one uniform 401 for a wrong token or a disabled service", async () => {
    expect((await hook("sonarr", "wrong")).status).toBe(401);
    expect((await hook("radarr", "s3cret-token")).status).toBe(401);
  });

  it("accepts the right token from another origin (no session, no CSRF gate)", async () => {
    const res = await hook("sonarr", "s3cret-token");
    expect(res.status).toBeLessThan(300);
  });

  it("relays a sender's Test at once, never holding it (#346)", async () => {
    const res = await hook("sonarr", "s3cret-token");
    expect(await res.json()).toEqual({ ok: true, delivered: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hook.test");
    expect(pendingWebhookDigests()).toEqual([]);
  });

  it("holds an episode import for the burst digest instead of relaying it (#346)", async () => {
    const res = await hook("sonarr", "s3cret-token", {
      eventType: "Download",
      series: { id: 1, title: "The Bear" },
      episodes: [{ id: 101, seasonNumber: 4, episodeNumber: 1, title: "Ep 1" }],
      episodeFile: { quality: "WEBDL-1080p", size: 1024 ** 3 },
    });
    expect(await res.json()).toEqual({ ok: true, queued: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingWebhookDigests()).toEqual([{ key: "sonarr||Download|1", count: 1 }]);
  });

  it("relays an event at once when the digest store is full (its 64 groups pending)", async () => {
    const episode = (sid: number) => ({
      eventType: "Download",
      series: { id: sid, title: `Series ${sid}` },
      episodes: [{ id: sid * 10, seasonNumber: 1, episodeNumber: 1 }],
      episodeFile: { quality: "WEBDL-1080p", size: 1 },
    });
    for (let sid = 1; sid <= 64; sid += 1) {
      expect(await (await hook("sonarr", "s3cret-token", episode(sid))).json()).toEqual({ ok: true, queued: true });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    const res = await hook("sonarr", "s3cret-token", episode(65));
    expect(await res.json()).toEqual({ ok: true, delivered: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hook.test");
    expect(pendingWebhookDigests()).toHaveLength(64);
  });
});
