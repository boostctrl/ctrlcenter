import { NextRequest, NextResponse } from "next/server";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { readConfig } from "@/lib/config";
import { rateLimit, pruneRateLimit } from "@/lib/rate-limit";

// Allow a small burst of attempts per client, then lock that source out for the
// window. A separate, higher global cap backstops it so a flood of spoofed
// source IPs still can't run unbounded (PBKDF2-heavy) password checks.
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

// Mark the session cookie Secure only when the request actually arrived over
// HTTPS (directly or via a TLS-terminating proxy). Keying this off NODE_ENV
// instead would set Secure in the production container even on plain-HTTP
// deployments, where browsers silently drop the cookie on non-localhost
// origins — so the login would succeed but never stick.
function isHttps(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  return request.nextUrl.protocol === "https:";
}

export async function POST(request: NextRequest) {
  pruneRateLimit();
  // Per-client first; only consume the global budget when the client is still
  // within its own limit, so a single spoofed flood is what trips the backstop.
  const perClient = rateLimit(clientKey(request), MAX_ATTEMPTS, WINDOW_MS);
  const global = perClient.allowed
    ? rateLimit("login:global", GLOBAL_MAX_ATTEMPTS, WINDOW_MS)
    : null;
  if (!perClient.allowed || (global && !global.allowed)) {
    const retryAfterSeconds = Math.max(
      perClient.retryAfterSeconds,
      global?.retryAfterSeconds ?? 0
    );
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
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
  const { auth } = await readConfig();
  const ok = auth.passwordHash
    ? await verifyPasswordHash(password, auth.passwordHash, auth.passwordSalt)
    : verifyEnvPassword(password);

  if (!ok) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
