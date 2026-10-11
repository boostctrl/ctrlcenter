import { describe, it, expect } from "vitest";
import { isPrivateIp, securityChecklist, type SecurityFacts } from "./security-checklist";

// A deployment with nothing to fix, to vary one fact at a time.
const GREEN: SecurityFacts = {
  totpEnabled: true,
  passwordStored: true,
  passwordEnv: false,
  sessionSecret: "volume",
  sessionsPersisted: true,
  trustedProxyHops: 1,
  sessions: [{ ip: "203.0.113.9", https: true, forwarded: true }],
  actionsOn: [],
  idleHours: 24,
};

const row = (facts: Partial<SecurityFacts>, id: string) => {
  const found = securityChecklist({ ...GREEN, ...facts }).find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

describe("securityChecklist (#367)", () => {
  it("is all green for a hardened deployment", () => {
    const rows = securityChecklist(GREEN);
    expect(rows.map((r) => r.id)).toEqual(["totp", "password", "https", "proxy", "secret", "sessions", "actions", "idle"]);
    expect(rows.every((r) => r.level === "ok")).toBe(true);
  });

  it("flags two-factor authentication off as red", () => {
    expect(row({ totpEnabled: false }, "totp").level).toBe("bad");
  });

  it("grades the admin password: stored, env-only, none", () => {
    expect(row({}, "password").level).toBe("ok");
    expect(row({ passwordStored: false, passwordEnv: true }, "password")).toMatchObject({
      level: "warn",
      detail: expect.stringContaining("ADMIN_PASSWORD"),
    });
    expect(row({ passwordStored: false, passwordEnv: false }, "password").level).toBe("bad");
  });

  it("judges HTTPS from the sessions' sign-ins", () => {
    expect(row({ sessions: [{ ip: "10.0.0.5", https: false, forwarded: true }] }, "https").level).toBe("warn");
    expect(row({ sessions: [{ ip: null, https: false, forwarded: true }] }, "https").level).toBe("warn");
    expect(row({ sessions: [{ ip: "203.0.113.9", https: false, forwarded: true }] }, "https")).toMatchObject({
      level: "bad",
      detail: expect.stringContaining("203.0.113.9"),
    });
    expect(
      row(
        { sessions: [{ ip: "10.0.0.5", https: true, forwarded: true }, { ip: "10.0.0.6", https: false, forwarded: true }] },
        "https"
      ).level
    ).toBe("warn");
  });

  it("leaves the sign-in rows out when no session has been seen (boot)", () => {
    const ids = securityChecklist({ ...GREEN, sessions: [] }).map((r) => r.id);
    expect(ids).not.toContain("https");
    expect(ids).not.toContain("proxy");
    expect(ids).toContain("totp");
  });

  it("catches a proxy-hops setting that doesn't match the requests", () => {
    // Says "behind a proxy" but a sign-in came with no forwarded header: the
    // throttle can be dodged.
    expect(row({ trustedProxyHops: 1, sessions: [{ ip: "1.2.3.4", https: true, forwarded: false }] }, "proxy")).toMatchObject({
      level: "bad",
      detail: expect.stringContaining("TRUSTED_PROXY_HOPS=0"),
    });
    // Says "direct" but sign-ins are forwarded: everyone shares one throttle.
    expect(row({ trustedProxyHops: 0, sessions: [{ ip: "1.2.3.4", https: true, forwarded: true }] }, "proxy").level).toBe("warn");
    // Consistent either way.
    expect(row({ trustedProxyHops: 0, sessions: [{ ip: "1.2.3.4", https: true, forwarded: false }] }, "proxy").level).toBe("ok");
    expect(row({ trustedProxyHops: 2 }, "proxy")).toMatchObject({ level: "ok", detail: expect.stringContaining("2 proxies") });
  });

  it("flags a session secret derived from the password", () => {
    expect(row({ sessionSecret: "env" }, "secret").level).toBe("ok");
    expect(row({ sessionSecret: "password" }, "secret")).toMatchObject({
      level: "bad",
      detail: expect.stringContaining("SESSION_SECRET"),
    });
  });

  it("warns when the session list can't be persisted", () => {
    expect(row({ sessionsPersisted: false }, "sessions").level).toBe("warn");
  });

  it("ties dashboard actions to the second factor", () => {
    expect(row({ actionsOn: ["qBittorrent"] }, "actions")).toMatchObject({
      level: "ok",
      detail: expect.stringContaining("qBittorrent"),
    });
    expect(row({ actionsOn: ["qBittorrent", "Portainer"], totpEnabled: false }, "actions")).toMatchObject({
      level: "bad",
      detail: expect.stringContaining("blocked"),
    });
    expect(row({ actionsOn: ["a", "b", "c", "d", "e"] }, "actions").detail).toContain("a, b, c and 2 more");
  });

  it("warns on an idle timeout over a day", () => {
    expect(row({ idleHours: 1 }, "idle").detail).toContain("an hour");
    expect(row({ idleHours: 24 }, "idle").level).toBe("ok");
    expect(row({ idleHours: 72 }, "idle")).toMatchObject({ level: "warn", detail: expect.stringContaining("3 days") });
  });
});

describe("isPrivateIp", () => {
  it("knows the private and loopback ranges, and treats unknown as private", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.1.1", "::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", null]) {
      expect(isPrivateIp(ip), String(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "203.0.113.9", "2001:db8::1", "::ffff:203.0.113.9"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});
