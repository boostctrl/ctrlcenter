import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// Send test / Send sample (#291, #347): admin-only, through the saved
// channels. One webhook channel is seeded, and a subject prefix so a sample
// shows the saved options applying.
let POST: typeof import("./route").POST;
let session: string;

beforeAll(async () => {
  const configPath = await useScratchConfig();
  await fs.writeFile(
    configPath,
    YAML.dump({
      settings: {
        alerts: { channels: [{ id: "c1", type: "webhook", url: "https://hook.test" }] },
        webhooks: { subjectPrefix: "[Lab]" },
      },
    }),
    "utf8"
  );
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  ({ POST } = await import("./route"));
  session = await adminSession();
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const post = (body?: unknown, init: { session?: string; headers?: Record<string, string> } = { session }) =>
  POST(request("/api/alerts/test", { method: "POST", body, ...init }));
const posted = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe("POST /api/alerts/test", () => {
  it("needs a session, from this origin", async () => {
    expect((await post({ channel: "c1" }, {})).status).toBe(401);
    expect((await post({ channel: "c1" }, { session, headers: { "sec-fetch-site": "cross-site" } })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown sample with 400 and sends nothing", async () => {
    const res = await post({ sample: "nope" });
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the synthetic down alert for a channel, or bodyless to every active one", async () => {
    const res = await post({ channel: "c1" });
    expect(await res.json()).toEqual({
      results: [{ id: "c1", label: "Webhook", ok: true, detail: "HTTP 204" }],
    });
    expect(posted().status).toBe("down");
    fetchMock.mockClear();
    expect(await (await post()).json()).toEqual({
      results: [{ id: "c1", label: "Webhook", ok: true, detail: "HTTP 204" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a sample event through the channels that take inbound webhooks, with the saved options (#347)", async () => {
    const res = await post({ sample: "sonarr-import" });
    expect(await res.json()).toEqual({
      results: [{ id: "c1", label: "Webhook", ok: true, detail: "HTTP 204" }],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://hook.test");
    // The default burst window is on, so the season goes merged.
    expect(posted().title).toBe("Sonarr imported 8 episodes of The Bear (S04E01-E08)");
  });
});
