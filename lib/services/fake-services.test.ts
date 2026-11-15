import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFakeServices, fakeIntegrations } from "../../scripts/fake-services.mjs";
import { SERVICES } from "./registry";
import { resolveIntegration } from "./resolve";
import { integrationSchema, type Integration } from "../schema";

// The sample data the smoke run and local development use (#507), read by
// the real service clients: every integration's snapshot and detail come
// back populated, so a client that starts calling an endpoint the fake
// server doesn't answer fails here, not as a blank screenshot.
let server: { base: string; close: () => Promise<void> };
let integrations: Integration[];

beforeAll(async () => {
  server = await startFakeServices();
  integrations = fakeIntegrations(server.base).map((i) => integrationSchema.parse(i));
});
afterAll(() => server.close());

const nonEmpty = (v: unknown) => JSON.stringify(v).length > 20;

describe("the fake services (#507)", () => {
  it("covers every integration type", () => {
    expect(new Set(integrations.map((i) => i.type))).toEqual(new Set(Object.keys(SERVICES)));
  });

  it.each(["sonarr", "radarr", "seerr", "tautulli", "qbittorrent", "portainer", "truenas", "adguard", "unifi"])(
    "serves %s's snapshot and detail through the real client",
    async (type) => {
      const integration = integrations.find((i) => i.type === type)!;
      const service = SERVICES[integration.type] as {
        snapshot: (c: unknown) => Promise<unknown>;
        detail: (c: unknown) => Promise<unknown>;
      };
      const cfg = resolveIntegration(integration);
      const [snapshot, detail] = await Promise.all([service.snapshot(cfg), service.detail(cfg)]);
      expect(nonEmpty(snapshot)).toBe(true);
      expect(nonEmpty(detail)).toBe(true);
    }
  );

  it("answers a wrong key as the real service would", async () => {
    const sonarr = integrations.find((i) => i.type === "sonarr")!;
    await expect(SERVICES.sonarr.snapshot(resolveIntegration({ ...sonarr, apiKey: "wrong" }))).rejects.toThrow(
      "Invalid API key"
    );
  });
});
