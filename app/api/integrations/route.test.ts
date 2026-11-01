import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, staleSession } from "@/lib/testing/routes";
import { integrationSchema } from "@/lib/schema";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

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

  it("stores the actions opt-in off while two-factor authentication is off (#367)", async () => {
    const qb = integrationSchema.parse({ id: "qb", type: "qbittorrent", url: "http://q", username: "u", password: "p", allowActions: true });
    expect((await put([qb])).status).toBe(200);
    const { readConfigInternal, activateTotp } = await import("@/lib/config");
    expect((await readConfigInternal()).integrations[0].allowActions).toBe(false);
    // With the factor on, the opt-in is kept.
    await activateTotp(FOUNDING_ACCOUNT_ID, "JBSWY3DPEHPK3PXP", []);
    expect((await put([qb])).status).toBe(200);
    expect((await readConfigInternal()).integrations[0].allowActions).toBe(true);
  });

  it("turns actions off on the session alone, but asks to confirm turning them on (#366)", async () => {
    // Settings clears the opt-in from its draft when the second factor goes
    // off (#384); that save must not prompt for the password.
    const { replaceIntegrations, readConfigInternal } = await import("@/lib/config");
    const { verifySessionId } = await import("@/lib/auth");
    const { markReauth } = await import("@/lib/sessions");
    const { REAUTH_WINDOW_MS } = await import("@/lib/reauth");
    const qb = integrationSchema.parse({ id: "qb", type: "qbittorrent", url: "http://q", username: "u", password: "p", allowActions: true });
    await replaceIntegrations([qb]);
    const stale = await adminSession();
    const id = await verifySessionId(stale, (await readConfigInternal()).auth);
    if (!id) throw new Error("no session");
    await markReauth(id, Date.now() - REAUTH_WINDOW_MS - 1);
    const putStale = (body: unknown) => route.PUT(request("/api/integrations", { method: "PUT", body, session: stale }));
    expect((await putStale([{ ...qb, allowActions: false }])).status).toBe(200);
    expect((await readConfigInternal()).integrations[0].allowActions).toBe(false);
    expect((await putStale([qb])).status).toBe(403);
  });
});

describe("PUT /api/integrations with the admin's placeholders (#382)", () => {
  it("keeps the stored key when the placeholder comes back, without asking to confirm", async () => {
    const { SECRET_PLACEHOLDER } = await import("@/lib/schema");
    const { readConfigInternal } = await import("@/lib/config");
    expect((await put([sonarr("keep")])).status).toBe(200);
    const stale = await adminSession();
    await staleSession(stale);
    const saved = await route.PUT(
      request("/api/integrations", { method: "PUT", body: [{ ...sonarr("keep"), apiKey: SECRET_PLACEHOLDER, enabled: false }], session: stale })
    );
    expect(saved.status).toBe(200);
    expect((await readConfigInternal()).integrations.find((i) => i.id === "keep")).toMatchObject({ apiKey: "secret", enabled: false });
  });
});

describe("PUT /api/integrations with a patch (#396)", () => {
  it("applies an edit by id and keeps an integration added in another tab", async () => {
    expect((await put([sonarr("one")])).status).toBe(200);
    const { readConfigInternal } = await import("@/lib/config");
    // Another tab adds a second one.
    expect((await put([sonarr("one"), sonarr("two")])).status).toBe(200);
    // This tab, from before that: renames the first with a patch.
    const res = await put({ upsert: [{ ...sonarr("one"), name: "Main" }] });
    expect(res.status).toBe(200);
    expect((await readConfigInternal()).integrations.map((i) => [i.id, i.name])).toEqual([["one", "Main"], ["two", ""]]);
    expect((await put({ remove: ["two"], order: ["one"] })).status).toBe(200);
    expect((await readConfigInternal()).integrations.map((i) => i.id)).toEqual(["one"]);
  });
});
