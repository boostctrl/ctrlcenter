import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { integrationSchema } from "@/lib/schema";

// Integrations (#300): the admin replaces the whole list.
let route: typeof import("./route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
});

const put = (body: unknown, auth = true) =>
  route.PUT(request("/api/integrations", { method: "PUT", body, session: auth ? session : undefined }));
const sonarr = (id: string) => integrationSchema.parse({ id, type: "sonarr", url: "http://s", apiKey: "secret" });

describe("PUT /api/integrations", () => {
  it("requires a session", async () => {
    expect((await put([], false)).status).toBe(401);
  });

  it("rejects a repeated id, an unknown type or a bad id", async () => {
    expect((await put([sonarr("a"), sonarr("a")])).status).toBe(400);
    expect((await put([{ ...sonarr("a"), type: "plex" }])).status).toBe(400);
    expect((await put([{ ...sonarr("a"), id: "a b" }])).status).toBe(400);
  });

  it("saves two of a type and never echoes the credentials", async () => {
    const res = await put([sonarr("sonarr"), sonarr("sonarr-4k")]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { readConfigInternal } = await import("@/lib/config");
    expect((await readConfigInternal()).integrations.map((i) => i.id)).toEqual(["sonarr", "sonarr-4k"]);
  });
});
