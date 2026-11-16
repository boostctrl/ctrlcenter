import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession, memberSession, staleSession, latestAuditEntry, TEST_ORIGIN } from "@/lib/testing/routes";
import { mockProvider, OP, CLIENT_ID, CLIENT_SECRET } from "@/lib/testing/oidc";

// The provider sign-in's settings (#504): admins only, the secret as a
// placeholder, every save behind a recent confirmation and recorded.
let GET: typeof import("./route").GET;
let PUT: typeof import("./route").PUT;
let config: typeof import("@/lib/config");
let admin: string;

const OIDC = {
  enabled: true,
  label: "Nextcloud",
  issuer: OP,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  scopes: "openid profile email groups",
  usernameClaim: "preferred_username",
  groupsClaim: "groups",
  createAccounts: false,
  enforcesTwoFactor: false,
  endProviderSession: false,
};

beforeAll(async () => {
  await useScratchConfig(YAML.dump({}));
  vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  ({ GET, PUT } = await import("./route"));
  config = await import("@/lib/config");
  admin = await adminSession();
});
afterEach(() => vi.unstubAllGlobals());

const save = (oidc: unknown, session = admin) => PUT(request("/api/sign-in", { method: "PUT", body: { oidc }, session }));
const read = async (query = "") => (await GET(request(`/api/sign-in${query}`, { session: admin }))).json();

describe("/api/sign-in", () => {
  it("is for admins only", async () => {
    const member = await memberSession("sam");
    expect((await GET(request("/api/sign-in", { session: member }))).status).toBe(401);
    expect((await save(OIDC, member)).status).toBe(401);
  });

  it("saves after a recent confirmation, records it, and hands the secret back as a placeholder", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    expect((await save(OIDC, stale)).status).toBe(403);
    expect((await save(OIDC)).status).toBe(200);
    expect(await latestAuditEntry()).toMatchObject({ kind: "signin.provider", detail: "on" });
    const body = await read();
    expect(body.oidc).toMatchObject({ enabled: true, label: "Nextcloud", issuer: OP, clientSecret: "••••••••" });
    expect(body.redirectUri).toBe(`${TEST_ORIGIN}/api/auth/oidc/callback`);
    expect(body.secretFromEnv).toBe(false);
  });

  it("keeps the stored secret when the placeholder comes back", async () => {
    expect((await save({ ...OIDC, label: "Cloud", clientSecret: "••••••••" })).status).toBe(200);
    const stored = (await config.readConfigInternal()).settings.signIn.oidc;
    expect(stored).toMatchObject({ label: "Cloud", clientSecret: CLIENT_SECRET });
  });

  it("refuses an issuer that isn't an http(s) address", async () => {
    expect((await save({ ...OIDC, issuer: "javascript:alert(1)" })).status).toBe(400);
  });

  it("checks the saved provider on request", async () => {
    const provider = await mockProvider();
    vi.stubGlobal("fetch", provider.fetch);
    expect((await read("?check=1")).check).toEqual({ ok: true });
    vi.stubGlobal("fetch", async () => new Response("no", { status: 404 }));
    expect((await read("?check=1")).check).toMatchObject({ ok: false });
  });

  it("keeps the provider's settings from a visitor", async () => {
    const { readPublicConfig } = await import("@/lib/api-auth");
    const visible = await readPublicConfig(request("/"));
    expect(JSON.stringify(visible)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(visible)).not.toContain(OP);
  });
});
