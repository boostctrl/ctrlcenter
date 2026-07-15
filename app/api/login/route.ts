import { NextRequest, NextResponse } from "next/server";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { readConfigInternal } from "@/lib/config";
import { rateLimit, pruneRateLimit } from "@/lib/rate-limit";

// Allow a small burst of attempts per client, then lock that source out for the
// window — the primary gate, checked before any password hashing. A separate,
// higher global cap backstops a distributed brute force, but it counts only
// FAILED attempts and is enforced only after a wrong password: a correct
// password is never charged against it, so an attacker can't exhaust the shared
// budget to lock the real admin out of login (#158).
const MAX_ATTEMPTS = 5;
const GLOBAL_MAX_ATTEMPTS = 50;
const WINDOW_MS = 5 * 60 * 1000;

// Number of trusted reverse proxies in front of the app (each appends to
// X-Forwarded-For). The real client IP is this many entries from the right;
// entries to the left are client-supplied and must not be trusted for
// throttling. Default 1 (the documented "behind a reverse proxy" setup). Set to
// 0 when exposing the app directly so a forged header can't mint fresh keys.
const TRUSTED_PROXY_HOPS = Math.max(
  0,
  Math.trunc(Number(process.env.TRUSTED_PROXY_HOPS ?? "1")) || 0
);

function clientKey(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff || TRUSTED_PROXY_HOPS === 0) return "login:unknown";
  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = parts.length - TRUSTED_PROXY_HOPS;
  return `login:${idx >= 0 ? parts[idx] : "unknown"}`;
}

export async function POST(request: NextRequest) {
  pruneRateLimit();
  // Per-client throttle first — checked and consumed before any PBKDF2 work, so
  // one source can't run unbounded password hashing, and behind the documented
  // reverse proxy the key is the real client IP (not the spoofable X-Forwarded-For
  // prefix). This is the gate that stops a single attacker; the global backstop
  // below only counts failures so it can't lock the real admin out.
  const perClient = rateLimit(clientKey(request), MAX_ATTEMPTS, WINDOW_MS);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(perClient.retryAfterSeconds) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const password = body?.password;

  if (typeof password !== "string") {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Prefer a password set through the UI (stored hash); otherwise fall back to
  // the ADMIN_PASSWORD env var.
  const { auth } = await readConfigInternal();
  const ok = auth.passwordHash
    ? await verifyPasswordHash(password, auth.passwordHash, auth.passwordSalt)
    : verifyEnvPassword(password);

  if (!ok) {
    // Charge the global backstop only on a wrong password, and enforce it only
    // here — a correct password never reaches this branch, so the shared budget
    // can't be used to deny the legitimate admin. The cap still bounds a
    // distributed brute force: once too many failures land in the window,
    // further wrong guesses are refused regardless of source (#158).
    const global = rateLimit("login:global", GLOBAL_MAX_ATTEMPTS, WINDOW_MS);
    if (!global.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(global.retryAfterSeconds) },
        }
      );
    }
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Bind the token to the current password hash so a later password change
  // revokes it (see proxy.ts / verifySessionToken).
  const token = await createSessionToken(auth.passwordHash);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(request)
  );
  return response;
}
