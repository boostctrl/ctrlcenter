import { NextRequest, NextResponse } from "next/server";
import { issueSession, setSessionCookie, verifyFlow } from "@/lib/auth";
import { findAccount } from "@/lib/accounts";
import { isSameOriginRequest } from "@/lib/api-auth";
import { noteSignIn, readConfigInternal } from "@/lib/config";
import { verifySecondFactor } from "@/lib/credentials";
import { OIDC_CODE_COOKIE, type PendingOidcSignIn } from "@/lib/oidc-responses";
import { clientKey, rateLimit, refundRateLimit } from "@/lib/rate-limit";
import { PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS, chargeWrongCode, codeChecksPausedFor } from "@/lib/login-throttle";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { CODES_LOCKED, notifySecurityEvent } from "@/lib/security-alerts";

// The second step of a provider sign-in (#504): the provider vouched for
// who it is but not for a second factor, and the account has its own, so
// its code (or a recovery code) finishes the sign-in. Throttled like the
// password form's code step: per client, and the shared wrong-code budget
// (#392).
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const pending = await verifyFlow<PendingOidcSignIn>(request.cookies.get(OIDC_CODE_COOKIE)?.value, "oidc-code");
  if (!pending) {
    return NextResponse.json({ error: "The sign-in took too long. Start it again.", expired: true }, { status: 401 });
  }
  const throttleKey = clientKey(request, "login");
  const perClient = rateLimit(throttleKey, PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfterSeconds) } }
    );
  }
  const paused = codeChecksPausedFor();
  if (paused > 0) {
    return NextResponse.json({ error: "Too many wrong codes. Try again later." }, { status: 429, headers: { "Retry-After": String(paused) } });
  }
  const { auth } = await readConfigInternal();
  const account = findAccount(auth, pending.account);
  if (!account?.enabled) return NextResponse.json({ error: "This account can't sign in." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const result = await verifySecondFactor(account, body?.totp);
  const meta = eventMeta(request, account.id);
  if (!result.ok) {
    if (result.reason === "totp-required") {
      refundRateLimit(throttleKey, { keepStrikes: true });
      return NextResponse.json({ error: "Enter your authentication code" }, { status: 401 });
    }
    await recordSecurityEvent("signin.fail", meta);
    if (chargeWrongCode()) notifySecurityEvent(await recordSecurityEvent("signin.locked", meta, CODES_LOCKED));
    return NextResponse.json({ error: "Invalid authentication code" }, { status: 401 });
  }
  refundRateLimit(throttleKey);
  const { token } = await issueSession(request, account, { via: "oidc", groups: pending.groups });
  await noteSignIn(account.id);
  notifySecurityEvent(await recordSecurityEvent("signin.ok", meta));
  const res = NextResponse.json({ ok: true, next: pending.next, popup: pending.popup });
  res.cookies.delete({ name: OIDC_CODE_COOKIE, path: "/api/auth/oidc/code" });
  setSessionCookie(res, request, token);
  return res;
}
