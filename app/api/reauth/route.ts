import { NextRequest, NextResponse } from "next/server";
import { adminSessionId } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { verifyCredentials } from "@/lib/credentials";
import { clientKey, pruneRateLimit, rateLimit, refundRateLimit } from "@/lib/rate-limit";
import { markReauth } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// Step-up confirmation (#366): a signed-in admin re-proves the password (and
// the second factor when on) so the sensitive routes behind
// requireRecentAuth let them through for the next while. Admin-only (proxy
// prefix + session re-check) and throttled per client like sign-in, so it
// isn't a second place to guess the password.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const sessionId = await adminSessionId(request, config.auth.passwordHash);
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  pruneRateLimit();
  const throttleKey = clientKey(request, "reauth");
  const limited = rateLimit(throttleKey, MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  const body = await request.json().catch(() => null);
  const result = await verifyCredentials(config.auth, body?.password, body?.totp);
  if (!result.ok) {
    if (result.reason !== "totp-required") await recordSecurityEvent("reauth.fail", eventMeta(request));
    if (result.reason === "totp-required") {
      return NextResponse.json(
        { error: "Enter your authentication code", totpRequired: true },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        error: result.reason === "code" ? "Invalid authentication code" : "Invalid password",
        totpRequired: config.auth.totp.enabled,
      },
      { status: 401 }
    );
  }
  refundRateLimit(throttleKey);
  await markReauth(sessionId);
  await recordSecurityEvent("reauth.ok", eventMeta(request));
  return NextResponse.json({ ok: true });
}
