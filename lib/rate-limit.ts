// Minimal in-memory fixed-window rate limiter for the login endpoint.
//
// This is intentionally process-local: the app is designed to run as a single
// self-hosted container, so a Map is sufficient and avoids a dependency on
// Redis or similar. If this were ever scaled horizontally, login throttling
// would need a shared store instead.
import type { NextRequest } from "next/server";

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
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
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
  };
}

// Opportunistically drop expired windows so the Map can't grow unbounded from
// a stream of distinct keys (e.g. spoofed source IPs).
export function pruneRateLimit(now = Date.now()): void {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
}

// Number of trusted reverse proxies in front of the app (each appends to
// X-Forwarded-For). The real client IP is this many entries from the right;
// entries to the left are client-supplied and must not be trusted for
// throttling. Default 1 (the documented "behind a reverse proxy" setup). Set
// to 0 when exposing the app directly so a forged header can't mint fresh keys.
const TRUSTED_PROXY_HOPS = Math.max(
  0,
  Math.trunc(Number(process.env.TRUSTED_PROXY_HOPS ?? "1")) || 0
);

// Set by scripts/server-entry.mjs (the Docker image's entry point), which
// stamps every request with its TCP peer address under this header — the one
// address a client can't forge. Only trusted when that entry is running:
// under `next start` the flag is absent and a client-sent header is ignored.
const PEER_HEADER = "x-ctrlcenter-peer";

// A rate-limit key for the requesting client under a namespace (e.g. "login",
// "2fa"). Behind the documented reverse proxy this is the real client IP, not
// the spoofable X-Forwarded-For prefix. Shared by the login and 2FA routes so
// the trusted-hops logic lives in one place.
export function clientKey(request: NextRequest, prefix: string): string {
  return `${prefix}:${clientIp(request) ?? "unknown"}`;
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
  if (process.env.CTRLCENTER_PEER_HEADER === "1" && peer) {
    const chain = [...forwardedFor(request), peer];
    return chain[chain.length - 1 - TRUSTED_PROXY_HOPS] ?? null;
  }
  const parts = forwardedFor(request);
  if (parts.length === 0 || TRUSTED_PROXY_HOPS === 0) return null;
  return parts[parts.length - TRUSTED_PROXY_HOPS] ?? null;
}
