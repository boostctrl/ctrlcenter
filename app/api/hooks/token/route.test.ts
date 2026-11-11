import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  useScratchConfig,
  request,
  adminSession,
  memberSession,
  otherAdminSession,
  latestAuditEntry,
} from "@/lib/testing/routes";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

// Reading an inbound-webhook token (#382): admin-only, and in the audit log
// under the admin who read it (#457).
let route: typeof import("./route");

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
});

const reveal = (session?: string) => route.GET(request("/api/hooks/token?service=sonarr", { session }));

describe("GET /api/hooks/token", () => {
  it("refuses a visitor and a member", async () => {
    expect((await reveal()).status).toBe(401);
    expect((await reveal(await memberSession("sam"))).status).toBe(401);
  });

  it("credits the reveal to the admin who asked (#457)", async () => {
    expect((await reveal(await adminSession())).status).toBe(200);
    expect(await latestAuditEntry()).toMatchObject({ kind: "secret.revealed", account: FOUNDING_ACCOUNT_ID });
    expect((await reveal(await otherAdminSession("ada"))).status).toBe(200);
    expect(await latestAuditEntry()).toMatchObject({ kind: "secret.revealed", account: "ada" });
  });
});
