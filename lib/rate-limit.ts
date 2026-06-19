// Minimal in-memory fixed-window rate limiter for the login endpoint.
//
// This is intentionally process-local: the app is designed to run as a single
// self-hosted container, so a Map is sufficient and avoids a dependency on
// Redis or similar. If this were ever scaled horizontally, login throttling
// would need a shared store instead.
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
