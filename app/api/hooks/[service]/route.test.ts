import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, params } from "@/lib/testing/routes";

// Inbound webhooks (#204, #289): a public route gated only by its token.
let POST: typeof import("./route").POST;

beforeAll(async () => {
  const configPath = await useScratchConfig();
  await fs.writeFile(
    configPath,
    YAML.dump({
      settings: {
        webhooks: { enabled: true, sonarr: { enabled: true, token: "s3cret-token" } },
      },
    }),
    "utf8"
  );
  ({ POST } = await import("./route"));
});

const hook = (service: string, token: string) =>
  POST(
    request(`/api/hooks/${service}?token=${token}`, {
      method: "POST",
      body: { eventType: "Test" },
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
});
