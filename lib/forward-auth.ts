// Signing in through the reverse proxy's headers (#504): a forward-auth
// proxy (Authelia, Authentik, oauth2-proxy) has signed the person in and
// says who they are, and their groups, in headers on every request. Those
// headers are believed only on a connection from one of the proxy's own
// addresses, as the Docker image's entry stamps it (peerAddress): anyone
// who reaches the app around the proxy can set the same headers, but not
// the address they connect from. Outside that entry, or with no address
// set, nothing is believed.
import { BlockList, isIP } from "node:net";
import { peerAddress } from "./rate-limit";
import { USER_ID_PATTERN } from "./schema/auth";
import type { ForwardAuthConfig } from "./schema/sign-in";

// An address or a CIDR range, as the settings take it; null when it's
// neither.
function entryOf(entry: string): { address: string; prefix: number | null; type: "ipv4" | "ipv6" } | null {
  const [address, bits] = entry.trim().split("/");
  const v = isIP(address);
  if (!v) return null;
  const type = v === 4 ? "ipv4" : "ipv6";
  if (bits === undefined) return { address, prefix: null, type };
  const prefix = Number(bits);
  const max = v === 4 ? 32 : 128;
  return /^\d+$/.test(bits) && prefix >= 0 && prefix <= max ? { address, prefix, type } : null;
}

// The entries that aren't an address or a range, for the settings to refuse.
export function badProxyEntries(entries: readonly string[]): string[] {
  return entries.filter((e) => e.trim() !== "" && !entryOf(e));
}

// Whether `peer` is one of the proxy's addresses. An IPv4 peer reported in
// its IPv6-mapped form (::ffff:10.0.0.2) is matched as IPv4.
export function fromProxy(peer: string | null, proxies: readonly string[]): boolean {
  if (!peer) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(peer);
  const address = mapped ? mapped[1] : peer;
  const type = isIP(address) === 4 ? "ipv4" : isIP(address) === 6 ? "ipv6" : null;
  if (!type) return false;
  const list = new BlockList();
  for (const e of proxies) {
    const entry = entryOf(e);
    if (!entry) continue;
    if (entry.prefix === null) list.addAddress(entry.address, entry.type);
    else list.addSubnet(entry.address, entry.prefix, entry.type);
  }
  return list.check(address, type);
}

// Who the proxy says this is: the user header's name (lowercased; null when
// it can't be a sign-in name, `raw` keeping what was sent) and the groups
// header's names. Null when forward-auth is off, the request didn't come
// from the proxy, or carries no user header.
export type ForwardIdentity = { username: string | null; raw: string; groups: string[] };
export function forwardIdentity(headers: Headers, fa: ForwardAuthConfig): ForwardIdentity | null {
  if (!fa.enabled || !fromProxy(peerAddress(headers), fa.proxies)) return null;
  const raw = headers.get(fa.userHeader)?.trim() ?? "";
  if (!raw) return null;
  const username = raw.toLowerCase();
  const groups = fa.groupsHeader
    ? [...new Set((headers.get(fa.groupsHeader) ?? "").split(/[,\s]+/).map((g) => g.trim().toLowerCase()).filter(Boolean))]
    : [];
  return { username: USER_ID_PATTERN.test(username) ? username : null, raw: raw.slice(0, 64), groups };
}

// After signing out of a forward-auth session with no proxy sign-out to go
// to, the headers would sign the person straight back in; this cookie, for
// the browser session, holds that off until they choose to continue.
export const SIGNED_OUT_COOKIE = "ctrlcenter_signed_out";

// Whether a request should be signed in from the headers first: a page load
// (not an API call, the client router's own fetches, or the sign-in page
// itself), a usable name the proxy vouches for, not just signed out, and no
// session already for that account.
export function shouldSignInFromHeaders(opts: {
  method: string;
  pathname: string;
  headers: Headers;
  identity: ForwardIdentity | null;
  signedOut: boolean;
  sessionAccount: string | null;
}): boolean {
  const { method, pathname, identity, headers } = opts;
  if (method !== "GET" || pathname.startsWith("/api/") || pathname === "/login" || pathname === "/admin/login") return false;
  if (headers.has("rsc") || headers.has("next-router-prefetch")) return false;
  if (!identity?.username || opts.signedOut) return false;
  return opts.sessionAccount !== identity.username;
}
