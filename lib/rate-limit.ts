// Minimal in-memory fixed-window rate limiter for the login endpoint.
//
// This is intentionally process-local: the app is designed to run as a single
// self-hosted container, so a Map is sufficient and avoids a dependency on
// Redis or similar. If this were ever scaled horizontally, login throttling
// would need a shared store instead.
import type { NextRequest } from "next/server";

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

// Escalating lockouts (#369): each time a key fills its window, the next
// lockout lasts twice as long — 5, 10, 20, 40 minutes — up to an hour, so a
// guessing run slows to a crawl. The strikes clear on a refund (a
// successful sign-in) or once nothing has tripped for a day.
type Lockout = { strikes: number; at: number };
const lockouts = new Map<string, Lockout>();
export const MAX_LOCKOUT_MS = 60 * 60 * 1000;
const STRIKES_KEEP_MS = 24 * 60 * 60 * 1000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  // With `escalate`, each lockout of this key lengthens the next (see
  // Lockout above); the login and step-up routes set it.
  opts: { escalate?: boolean } = {}
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  if (opts.escalate && existing.count >= limit) {
    // This attempt filled the window: the lockout starts now, for longer
    // each time this key trips.
    const prior = lockouts.get(key);
    const strikes = prior && now - prior.at < STRIKES_KEEP_MS ? prior.strikes : 0;
    lockouts.set(key, { strikes: strikes + 1, at: now });
    existing.resetAt = now + Math.min(windowMs * 2 ** strikes, MAX_LOCKOUT_MS);
  }
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
  };
}

// Whether `key` would be refused right now, without charging it: the answer
// a charge would get. Lets a route refuse code checks while the shared
// wrong-code budget is spent (#392).
export function peekRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || now >= existing.resetAt) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

// Give back one charge to `key` (no-op once its window has expired). Login
// calls this when a session is actually issued, so signing in successfully a
// few times in a row can't lock the admin out (#277). One charge, not a reset:
// a success from a shared address mustn't wipe another client's failures.
// With `keepStrikes` the key's escalation history stays: the two-step form's
// password-only step is given back (#392) without counting as the admin
// having got in.
export function refundRateLimit(key: string, opts: { keepStrikes?: boolean } = {}): void {
  const existing = windows.get(key);
  if (existing && existing.count > 0 && Date.now() < existing.resetAt) {
    existing.count -= 1;
  }
  // The real admin got in: their earlier lockouts stop counting against them.
  if (!opts.keepStrikes) lockouts.delete(key);
}

// Opportunistically drop expired windows so the Map can't grow unbounded from
// a stream of distinct keys (e.g. spoofed source IPs).
export function pruneRateLimit(now = Date.now()): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
  for (const [key, lockout] of lockouts) {
    if (now - lockout.at >= STRIKES_KEEP_MS) lockouts.delete(key);
  }
}

// Number of trusted reverse proxies in front of the app (each appends to
// X-Forwarded-For). The real client IP is this many entries from the right;
// entries to the left are client-supplied and must not be trusted for
// throttling. Default 1 (the documented "behind a reverse proxy" setup). Set
// to 0 when exposing the app directly so a forged header can't mint fresh keys.
export const TRUSTED_PROXY_HOPS = Math.max(
  0,
  Math.trunc(Number(process.env.TRUSTED_PROXY_HOPS ?? "1")) || 0
);

// Set by scripts/server-entry.mjs (the Docker image's entry point), which
// stamps every request with its TCP peer address under this header — the one
// address a client can't forge. Only trusted when that entry is running:
// under `next start` the flag is absent and a client-sent header is ignored.
const PEER_HEADER = "x-ctrlcenter-peer";
// Stamped by the same entry: "1" when the request reached the server carrying
// X-Forwarded-For, "0" when it didn't (#383). Trusted on the same terms.
const FORWARDED_HEADER = "x-ctrlcenter-forwarded";

// Whether scripts/server-entry.mjs is running, so the headers it stamps can be
// trusted.
export function productionEntry(): boolean {
  return process.env.CTRLCENTER_PEER_HEADER === "1";
}

// A rate-limit key for the requesting client under a namespace (e.g. "login",
// "2fa"). Behind the documented reverse proxy this is the real client IP, not
// the spoofable X-Forwarded-For prefix. Shared by the login and 2FA routes so
// the trusted-hops logic lives in one place. An IPv6 client is keyed by its
// /64 (throttleBucket), so one allotment can't mint a fresh budget per address.
export function clientKey(request: NextRequest, prefix: string): string {
  const ip = clientIp(request);
  return `${prefix}:${ip ? throttleBucket(ip) : "unknown"}`;
}

// The address a throttle counts. An IPv4 address stands for itself. An IPv6
// address stands for its /64: the block a provider hands one subscriber or
// one VPS, which holds 2^64 addresses a client can rotate through at no cost,
// so keying on the full address gave a single machine a fresh budget per
// guess (#392). An IPv4-mapped IPv6 address counts as the IPv4 address it
// carries. Text that isn't an address is returned as given.
export function throttleBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && mapped[1].split(".").every((octet) => Number(octet) <= 255)) return mapped[1];
  const groups = ipv6Groups(ip);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

// The eight 16-bit groups of an IPv6 address as four-digit lowercase hex, or
// null when the text isn't one. Handles "::" compression, a zone id and a
// dotted IPv4 tail.
function ipv6Groups(ip: string): string[] | null {
  let text = ip.split("%")[0];
  const tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const octets = tail[1].split(".").map(Number);
    if (octets.some((n) => n > 255)) return null;
    text =
      text.slice(0, tail.index + 1) +
      ((octets[0] << 8) | octets[1]).toString(16) +
      ":" +
      ((octets[2] << 8) | octets[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => g.toLowerCase().padStart(4, "0"));
}

function forwardedFor(request: NextRequest): string[] {
  return (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The requesting client's IP, or null when it can't be told apart from other
// clients.
//
// With the production entry (#257) the chain is X-Forwarded-For plus the
// socket peer, and the client is TRUSTED_PROXY_HOPS entries back from that
// peer: 0 = the peer itself (exposed directly), 1 = whatever the one trusted
// proxy saw, and so on. Each entry right of the client was appended by a
// trusted hop, so nothing the client sends can move it.
//
// Without the entry, the last X-Forwarded-For entry stands in for the peer
// (Next fills the header from the socket only when the client sent none), so
// hops=0 can't identify anyone and the old, spoofable count applies.
export function clientIp(request: NextRequest): string | null {
  const peer = request.headers.get(PEER_HEADER)?.trim();
  if (productionEntry() && peer) {
    const chain = [...forwardedFor(request), peer];
    return chain[chain.length - 1 - TRUSTED_PROXY_HOPS] ?? null;
  }
  const parts = forwardedFor(request);
  if (parts.length === 0 || TRUSTED_PROXY_HOPS === 0) return null;
  return parts[parts.length - TRUSTED_PROXY_HOPS] ?? null;
}

// Whether the request came through a proxy — it reached the server with an
// X-Forwarded-For header — or null when the app can't tell. The header itself
// says nothing by the time a route reads it: Next fills it in from the socket
// on every request that lacks one (#383). Only the production entry sees the
// request first, so only its stamp counts.
export function arrivedForwarded(request: NextRequest): boolean | null {
  if (!productionEntry()) return null;
  const stamp = request.headers.get(FORWARDED_HEADER);
  return stamp === "1" ? true : stamp === "0" ? false : null;
}
