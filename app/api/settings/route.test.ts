import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, staleSession } from "@/lib/testing/routes";

// Settings read/update (#289): auth, validation, and a partial update that
// leaves the rest of the settings alone.
let route: typeof import("./route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
});

const put = (body: unknown, auth = true) =>
  route.PUT(request("/api/settings", { method: "PUT", body, session: auth ? session : undefined }));

describe("/api/settings", () => {
  it("requires a session to read or write", async () => {
    expect((await route.GET(request("/api/settings"))).status).toBe(401);
    expect((await put({ title: "x" }, false)).status).toBe(401);
  });

  it("rejects an invalid value with 400", async () => {
    expect((await put({ statusInterval: "often" })).status).toBe(400);
  });

  it("applies a partial update without touching other settings", async () => {
    expect((await put({ title: "Home lab" })).status).toBe(200);
    expect((await put({ statusChecks: true })).status).toBe(200);
    const settings = await (await route.GET(request("/api/settings", { session }))).json();
    expect(settings.title).toBe("Home lab");
    expect(settings.statusChecks).toBe(true);
  });

  it("asks a stale session to confirm before re-pointing an email channel's server (#378)", async () => {
    const { alertChannelSchema } = await import("@/lib/schema");
    const channel = alertChannelSchema.parse({ id: "mail", type: "email", smtp: { host: "smtp.lan", user: "me" } });
    expect((await put({ alerts: { channels: [channel] } })).status).toBe(200);
    const stale = await adminSession();
    await staleSession(stale);
    const putAs = (body: unknown) => route.PUT(request("/api/settings", { method: "PUT", body, session: stale }));
    expect((await putAs({ title: "Lab" })).status).toBe(200);
    expect((await putAs({ alerts: { channels: [{ ...channel, name: "Mail" }] } })).status).toBe(200);
    const moved = await putAs({ alerts: { channels: [{ ...channel, name: "Mail", smtp: { ...channel.smtp, host: "evil.example" } }] } });
    expect(moved.status).toBe(403);
    expect(await moved.json()).toMatchObject({ reauthRequired: true });
    const settings = await (await route.GET(request("/api/settings", { session }))).json();
    expect(settings.alerts.channels[0].smtp.host).toBe("smtp.lan");
  });
});
