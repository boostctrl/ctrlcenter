import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { adminSession, request, useScratchConfig } from "@/lib/testing/routes";

// The password change (#369): the length and reuse rules, and that a change
// revokes every other session while reissuing the caller's.
let POST: typeof import("./route").POST;
let LIST: typeof import("../sessions/route").GET;

beforeAll(async () => {
  await useScratchConfig();
  ({ POST } = await import("./route"));
  ({ GET: LIST } = await import("../sessions/route"));
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_PASSWORD", "correct horse");
  const { setPasswordHash } = await import("@/lib/config");
  await setPasswordHash("", "");
});

const change = (session: string, current: string, next: string) =>
  POST(request("/api/password", { method: "POST", body: { current, next }, session }));

describe("POST /api/password", () => {
  it("needs a session and the current password", async () => {
    expect((await POST(request("/api/password", { method: "POST", body: { current: "x", next: "long enough password" } }))).status).toBe(401);
    const session = await adminSession();
    expect((await change(session, "wrong", "long enough password")).status).toBe(403);
  });

  it("wants at least 12 characters", async () => {
    const session = await adminSession();
    const res = await change(session, "correct horse", "short one");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/12 characters/);
  });

  it("refuses the current password and the container's ADMIN_PASSWORD", async () => {
    const session = await adminSession();
    expect((await change(session, "correct horse", "correct horse")).status).toBe(400);
    const { setPasswordHash } = await import("@/lib/config");
    const { hashPassword } = await import("@/lib/auth");
    const { hash, salt } = await hashPassword("stored password here");
    await setPasswordHash(hash, salt);
    const back = await change(await adminSession(hash), "stored password here", "correct horse");
    expect(back.status).toBe(400);
  });

  it("changes the password, signs every other session out and keeps the caller's", async () => {
    const mine = await adminSession();
    const other = await adminSession();
    const res = await change(mine, "correct horse", "a brand new passphrase");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const token = /homepage_admin_session=([^;]+)/.exec(cookie)?.[1];
    expect(token).toBeTruthy();
    const { readConfigInternal } = await import("@/lib/config");
    const { auth } = await readConfigInternal();
    expect(auth.passwordHash).not.toBe("");
    // The old tokens are bound to the old (empty) hash and their records are gone.
    expect((await LIST(request("/api/sessions", { session: other }))).status).toBe(401);
    expect((await LIST(request("/api/sessions", { session: mine }))).status).toBe(401);
    expect((await LIST(request("/api/sessions", { session: token }))).status).toBe(200);
  });
});
