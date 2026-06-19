import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { rateLimit, pruneRateLimit } from "@/lib/rate-limit";

// Allow a small burst of attempts, then lock the source out for the window.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  // x-forwarded-for is a comma-separated list; the first entry is the client.
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `login:${ip}`;
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
  const limit = rateLimit(clientKey(request), MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const password = body?.password;

  if (typeof password !== "string" || !verifyPassword(password)) {
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
