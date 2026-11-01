import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request } from "@/lib/testing/routes";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

// Sign-in per account (#423): its own wrong-password budget, and the audit
// log naming the account. In its own file: the budgets are module state,
// and this file spends one of them.
let POST: typeof import("./route").POST;
let ip = 0;
const loginAs = (username: string, password: string, address?: string) => {
  ip += 1;
  return POST(
    request("/api/login", {
      method: "POST",
      body: { username, password },
      headers: { "x-forwarded-for": address ?? `10.2.0.${ip}` },
    })
  );
};

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "correct horse");
  const { addAccount } = await import("@/lib/config");
  const { hashPassword } = await import("@/lib/auth");
  const { userSchema } = await import("@/lib/schema");
  const { hash, salt } = await hashPassword("sam-secret");
  await addAccount(userSchema.parse({ id: "sam", role: "member", passwordHash: hash, passwordSalt: salt }));
  ({ POST } = await import("./route"));
});

describe("POST /api/login per account (#423)", () => {
  it("signs an account in with its own password, names it in the log and notes the time", async () => {
    const res = await loginAs("sam", "sam-secret");
    expect(res.status).toBe(200);
    expect((await loginAs("sam", "correct horse")).status).toBe(401);
    const { listSecurityEvents } = await import("@/lib/security-events");
    const events = await listSecurityEvents(10);
    expect(events[0]).toMatchObject({ kind: "signin.fail", account: "sam" });
    expect(events[1]).toMatchObject({ kind: "signin.ok", account: "sam", newAddress: true });
    const { readConfigInternal } = await import("@/lib/config");
    const { findAccount } = await import("@/lib/accounts");
    const sam = findAccount((await readConfigInternal()).auth, "sam");
    expect(sam?.lastSignInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses further wrong guesses for one account once its budget is spent, from any address, and says so once", async () => {
    const { PER_ACCOUNT_MAX_ATTEMPTS } = await import("@/lib/login-throttle");
    // Four per address, so no client trips its own lockout first; one wrong
    // guess for Sam was already made above.
    for (let i = 0; i < PER_ACCOUNT_MAX_ATTEMPTS - 1; i++) {
      const res = await loginAs("sam", "wrong", `10.3.${Math.floor(i / 4) + 1}.1`);
      expect(res.status).toBe(401);
    }
    const refused = await loginAs("sam", "wrong", "10.3.200.1");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    // The right password still signs Sam in, and the admin isn't affected.
    expect((await loginAs("sam", "sam-secret", "10.3.201.1")).status).toBe(200);
    expect((await loginAs(FOUNDING_ACCOUNT_ID, "wrong", "10.3.202.1")).status).toBe(401);
    expect((await loginAs(FOUNDING_ACCOUNT_ID, "correct horse", "10.3.203.1")).status).toBe(200);
    const { listSecurityEvents } = await import("@/lib/security-events");
    const locked = (await listSecurityEvents(200)).filter((e) => e.kind === "signin.locked");
    expect(locked).toEqual([expect.objectContaining({ detail: "account", account: "sam" })]);
  });
});
