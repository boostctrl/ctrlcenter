import { describe, it, expect } from "vitest";
import { securityNotification } from "./security-alerts";
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
    expect(securityNotification(ev({ kind: "password.changed" }))?.title).toMatch(/password changed/);
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
