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

// A rate-limit key for the requesting client under a namespace (e.g. "login",
// "2fa"). Behind the documented reverse proxy this is the real client IP, not
// the spoofable X-Forwarded-For prefix. Shared by the login and 2FA routes so
// the trusted-hops logic lives in one place.
export function clientKey(request: NextRequest, prefix: string): string {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff || TRUSTED_PROXY_HOPS === 0) return `${prefix}:unknown`;
  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = parts.length - TRUSTED_PROXY_HOPS;
  return `${prefix}:${idx >= 0 ? parts[idx] : "unknown"}`;
}
