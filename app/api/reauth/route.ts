import { NextRequest, NextResponse } from "next/server";
import { adminSessionId } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { verifyCredentials } from "@/lib/credentials";
import { clientKey, pruneRateLimit, rateLimit, refundRateLimit } from "@/lib/rate-limit";
import {
  PER_CLIENT_MAX_ATTEMPTS,
  WINDOW_MS,
  chargeWrongCode,
  chargeWrongPassword,
  codeChecksPausedFor,
} from "@/lib/login-throttle";
import { markReauth } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { CODES_LOCKED, notifySecurityEvent } from "@/lib/security-alerts";

// Step-up confirmation (#366): a signed-in admin re-proves the password (and
// the second factor when on) so the sensitive routes behind
// requireRecentAuth let them through for the next while. Admin-only (proxy
// prefix + session re-check), throttled per client like sign-in and counted
// on the same shared budgets (#392), so it isn't a second place to guess the
// password or the code.

export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const sessionId = await adminSessionId(request, config.auth.passwordHash);
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  pruneRateLimit();
  const throttleKey = clientKey(request, "reauth");
  const limited = rateLimit(throttleKey, PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  const body = await request.json().catch(() => null);
  // No code is checked while the shared wrong-code budget is spent (#392);
  // see the sign-in route.
  const sentCode = typeof body?.totp === "string" && body.totp.trim() !== "";
  if (sentCode && config.auth.totp.enabled) {
    const paused = codeChecksPausedFor();
    if (paused > 0) {
      return NextResponse.json(
        { error: "Too many wrong codes. Try again later.", totpRequired: true },
        { status: 429, headers: { "Retry-After": String(paused) } }
      );
    }
  }
  const result = await verifyCredentials(config.auth, body?.password, body?.totp);
  if (!result.ok) {
    if (result.reason === "totp-required") {
      // The form's second step, not a failure: its charge goes back (#392).
      refundRateLimit(throttleKey, { keepStrikes: true });
      return NextResponse.json(
        { error: "Enter your authentication code", totpRequired: true },
        { status: 401 }
      );
    }
    await recordSecurityEvent("reauth.fail", eventMeta(request));
    if (result.reason === "password") {
      // A wrong password here is a guess at the same password as sign-in, and
      // counts on the same shared budget (#392).
      const global = chargeWrongPassword();
      if (!global.allowed) {
        return NextResponse.json(
          { error: "Too many attempts. Try again later." },
          { status: 429, headers: { "Retry-After": String(global.retryAfterSeconds) } }
        );
      }
    } else if (chargeWrongCode()) {
      notifySecurityEvent(await recordSecurityEvent("signin.locked", eventMeta(request), CODES_LOCKED));
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
