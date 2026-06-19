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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
