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

describe("/api/settings keeps credentials on the server (#382)", () => {
  it("answers with placeholders, keeps the stored value when one comes back, and clears on empty", async () => {
    const { alertChannelSchema, SECRET_PLACEHOLDER } = await import("@/lib/schema");
    const channel = alertChannelSchema.parse({ id: "tg", type: "telegram", token: "123:abc", chatId: "42" });
    expect((await put({ alerts: { channels: [channel] } })).status).toBe(200);
    const read = async () => (await (await route.GET(request("/api/settings", { session }))).json()).alerts.channels[0];
    expect(await read()).toMatchObject({ token: SECRET_PLACEHOLDER, chatId: "42" });
    // The form saves the row back with the placeholder: the token stays.
    const saved = await put({ alerts: { channels: [{ ...(await read()), chatId: "43" }] } });
    expect(saved.status).toBe(200);
    expect((await saved.json()).alerts.channels[0].token).toBe(SECRET_PLACEHOLDER);
    const { readConfigInternal } = await import("@/lib/config");
    expect((await readConfigInternal()).settings.alerts.channels[0]).toMatchObject({ token: "123:abc", chatId: "43" });
    // Emptied, it's gone.
    expect((await put({ alerts: { channels: [{ ...(await read()), token: "" }] } })).status).toBe(200);
    expect((await readConfigInternal()).settings.alerts.channels[0].token).toBe("");
  });

  it("asks a stale session to confirm before silencing the Security notifications", async () => {
    const { alertChannelSchema } = await import("@/lib/schema");
    const channel = alertChannelSchema.parse({ id: "sec", type: "telegram", token: "t", chatId: "1", onSecurity: true });
    expect((await put({ alerts: { channels: [channel] } })).status).toBe(200);
    const stale = await adminSession();
    await staleSession(stale);
    const putStale = (body: unknown) => route.PUT(request("/api/settings", { method: "PUT", body, session: stale }));
    // Turning the Security switch off, disabling the channel, or removing it.
    expect((await putStale({ alerts: { channels: [{ ...channel, onSecurity: false }] } })).status).toBe(403);
    expect((await putStale({ alerts: { channels: [{ ...channel, enabled: false }] } })).status).toBe(403);
    expect((await putStale({ alerts: { channels: [] } })).status).toBe(403);
    // Other edits to the channel pass on the session alone.
    expect((await putStale({ alerts: { channels: [{ ...channel, name: "Ops" }] } })).status).toBe(200);
  });

  it("announces a session used from a new address, once per address", async () => {
    const { listSecurityEvents } = await import("@/lib/security-events");
    const moved = async () => (await listSecurityEvents(200)).filter((e) => e.kind === "session.moved");
    const before = (await moved()).length;
    const from = (ip: string) => route.GET(request("/api/settings", { session, headers: { "x-forwarded-for": ip } }));
    expect((await from("198.51.100.7")).status).toBe(200);
    expect((await from("198.51.100.7")).status).toBe(200);
    let events = await moved();
    expect(events.length).toBe(before + 1);
    expect(events[0]).toMatchObject({ ip: "198.51.100.7", detail: "signed in from 127.0.0.1" });
    expect((await from("198.51.100.8")).status).toBe(200);
    events = await moved();
    expect(events.length).toBe(before + 2);
    // Back at the sign-in address, nothing new.
    expect((await from("127.0.0.1")).status).toBe(200);
    expect((await moved()).length).toBe(before + 2);
  });
});
