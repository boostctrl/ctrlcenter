import { describe, it, expect, afterEach, vi } from "vitest";
import { badProxyEntries, forwardIdentity, fromProxy, shouldSignInFromHeaders } from "./forward-auth";
import { forwardAuthSchema } from "./schema/sign-in";

// Signing in from the reverse proxy's headers (#504): believed only from
// the proxy's own address, as the Docker image's entry stamps it.
afterEach(() => vi.unstubAllEnvs());

describe("fromProxy", () => {
  it("matches an address, a range, IPv6, and an IPv4 peer in its IPv6-mapped form", () => {
    expect(fromProxy("172.18.0.2", ["172.18.0.2"])).toBe(true);
    expect(fromProxy("172.18.0.9", ["172.18.0.0/16"])).toBe(true);
    expect(fromProxy("::ffff:172.18.0.9", ["172.18.0.0/16"])).toBe(true);
    expect(fromProxy("fd00::5", ["fd00::/64"])).toBe(true);
    expect(fromProxy("10.0.0.2", ["172.18.0.0/16"])).toBe(false);
    expect(fromProxy(null, ["172.18.0.2"])).toBe(false);
    expect(fromProxy("172.18.0.2", [])).toBe(false);
    // An entry that is neither is left out, not a match for everything.
    expect(fromProxy("172.18.0.2", ["not an address", "0.0.0.0/99"])).toBe(false);
  });

  it("names the entries that are neither an address nor a range", () => {
    expect(badProxyEntries(["172.18.0.2", "10.0.0.0/8", "fd00::/64", "proxy.lan", "1.2.3.4/33", ""])).toEqual(["proxy.lan", "1.2.3.4/33"]);
  });
});

describe("forwardIdentity", () => {
  const fa = forwardAuthSchema.parse({ enabled: true, proxies: ["172.18.0.2"] });
  const headers = (h: Record<string, string>) => new Headers({ "x-ctrlcenter-peer": "172.18.0.2", ...h });

  it("reads the user and groups headers from the proxy, inside the Docker image only", () => {
    const h = headers({ "Remote-User": "Sam", "Remote-Groups": "Family, admins family" });
    expect(forwardIdentity(h, fa)).toBeNull();
    vi.stubEnv("CTRLCENTER_PEER_HEADER", "1");
    expect(forwardIdentity(h, fa)).toEqual({ username: "sam", raw: "Sam", groups: ["family", "admins"] });
  });

  it("believes nothing from another address, nothing while off, and nothing without a user", () => {
    vi.stubEnv("CTRLCENTER_PEER_HEADER", "1");
    expect(forwardIdentity(new Headers({ "x-ctrlcenter-peer": "203.0.113.9", "Remote-User": "sam" }), fa)).toBeNull();
    expect(forwardIdentity(headers({ "Remote-User": "sam" }), { ...fa, enabled: false })).toBeNull();
    expect(forwardIdentity(headers({}), fa)).toBeNull();
  });

  it("keeps a name that can't be a sign-in name as sent, with no username", () => {
    vi.stubEnv("CTRLCENTER_PEER_HEADER", "1");
    expect(forwardIdentity(headers({ "Remote-User": "Sam Smith" }), fa)).toMatchObject({ username: null, raw: "Sam Smith" });
  });
});

describe("shouldSignInFromHeaders", () => {
  const identity = { username: "sam", raw: "sam", groups: [] };
  const base = { method: "GET", pathname: "/", headers: new Headers(), identity, signedOut: false, sessionAccount: null };

  it("signs a page load in when the browser isn't signed in as that account", () => {
    expect(shouldSignInFromHeaders(base)).toBe(true);
    expect(shouldSignInFromHeaders({ ...base, sessionAccount: "kim" })).toBe(true);
    expect(shouldSignInFromHeaders({ ...base, sessionAccount: "sam" })).toBe(false);
  });

  it("leaves API calls, the client router's fetches, the sign-in pages and a fresh sign-out alone", () => {
    expect(shouldSignInFromHeaders({ ...base, pathname: "/api/status" })).toBe(false);
    expect(shouldSignInFromHeaders({ ...base, method: "POST" })).toBe(false);
    expect(shouldSignInFromHeaders({ ...base, headers: new Headers({ rsc: "1" }) })).toBe(false);
    expect(shouldSignInFromHeaders({ ...base, pathname: "/login" })).toBe(false);
    expect(shouldSignInFromHeaders({ ...base, pathname: "/admin/login" })).toBe(false);
    expect(shouldSignInFromHeaders({ ...base, signedOut: true })).toBe(false);
    expect(shouldSignInFromHeaders({ ...base, identity: { ...identity, username: null } })).toBe(false);
  });
});
