import { describe, it, expect } from "vitest";
import { CODES_LOCKED, notificationDue, securityNotification, ACCOUNT_LOCKED } from "./security-alerts";
import type { SecurityEvent } from "./security-events";

const at = Date.UTC(2026, 9, 11, 12, 0);
const ev = (over: Partial<SecurityEvent>): SecurityEvent => ({
  at,
  kind: "signin.ok",
  ip: "203.0.113.9",
  userAgent: "Chrome on macOS",
  ...over,
});

describe("securityNotification (#368)", () => {
  it("notifies a sign-in from a new address, not a known one", () => {
    expect(securityNotification(ev({ newAddress: false }))).toBeNull();
    const n = securityNotification(ev({ newAddress: true }));
    expect(n?.title).toMatch(/new address/);
    expect(n?.body).toContain("203.0.113.9");
    expect(n?.body).toContain("Chrome on macOS");
  });

  it("notifies the account-shaping events and the lockout", () => {
    expect(securityNotification(ev({ kind: "signin.locked" }))?.title).toMatch(/locked/);
    expect(securityNotification(ev({ kind: "totp.disabled" }))?.title).toMatch(/turned off/);
    expect(securityNotification(ev({ kind: "password.changed" }))?.title).toMatch(/password changed/i);
    expect(securityNotification(ev({ kind: "actions.enabled", detail: "qBittorrent" }))?.body).toContain("qBittorrent");
  });

  it("stays quiet for routine entries", () => {
    for (const kind of ["signin.fail", "signout", "session.ended", "reauth.ok", "action", "export.secrets"] as const) {
      expect(securityNotification(ev({ kind })), kind).toBeNull();
    }
  });

  it("never includes a secret and copes with an unknown address", () => {
    const n = securityNotification(ev({ newAddress: true, ip: null, userAgent: "" }));
    expect(n?.body).toContain("unknown address");
    expect(n?.body).toContain("unknown browser");
  });
});

describe("notification pacing (#392)", () => {
  it("sends one notice of a kind every ten minutes, but every new-address sign-in", () => {
    const t = Date.now();
    expect(notificationDue(ev({ kind: "signin.locked" }), t)).toBe(true);
    expect(notificationDue(ev({ kind: "signin.locked", ip: "198.51.100.4" }), t + 1000)).toBe(false);
    // The wrong-code pause is its own notice.
    expect(notificationDue(ev({ kind: "signin.locked", detail: CODES_LOCKED }), t + 2000)).toBe(true);
    expect(notificationDue(ev({ kind: "signin.locked" }), t + 11 * 60_000)).toBe(true);
    expect(notificationDue(ev({ newAddress: true }), t + 3000)).toBe(true);
    expect(notificationDue(ev({ newAddress: true, ip: "198.51.100.4" }), t + 4000)).toBe(true);
  });

  it("says when it was the codes that ran out, not one address's passwords", () => {
    const n = securityNotification(ev({ kind: "signin.locked", detail: CODES_LOCKED }));
    expect(n?.title).toMatch(/codes paused/);
    expect(n?.body).toMatch(/has the password/);
    expect(n?.body).toContain("203.0.113.9");
  });
});

describe("the account in a notification (#423)", () => {
  const base = { at: 1, ip: "203.0.113.9", userAgent: "Firefox" } as const;
  it("names the account that signed in, changed its password or had its guesses refused", () => {
    const signin = securityNotification({ ...base, kind: "signin.ok", newAddress: true, account: "sam" });
    expect(signin?.title).toBe("Sign-in from a new address");
    expect(signin?.body).toMatch(/^The account "sam" signed in/);
    const changed = securityNotification({ ...base, kind: "password.changed", account: "sam" });
    expect(changed?.body).toMatch(/password of "sam" was changed/);
    expect(changed?.body).toMatch(/session of that account/);
    const refused = securityNotification({ ...base, kind: "signin.locked", detail: ACCOUNT_LOCKED, account: "sam" });
    expect(refused?.title).toMatch(/guesses for an account refused/);
    expect(refused?.body).toMatch(/for "sam" from many addresses/);
    expect(refused?.body).toMatch(/right password still signs in/);
  });
  it("reads an entry 3.0 wrote, which names no account, as the admin's", () => {
    const signin = securityNotification({ ...base, kind: "signin.ok", newAddress: true });
    expect(signin?.body).toMatch(/^Someone signed in/);
    const off = securityNotification({ ...base, kind: "totp.disabled" });
    expect(off?.body).toMatch(/second factor of the admin was turned off/);
  });
});
