import { NextRequest, NextResponse } from "next/server";
import { issueSession, setSessionCookie, verifyFlow } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/api-auth";
import { accountsOf } from "@/lib/accounts";
import { noteSignIn, notePasskeyUse, readConfigInternal } from "@/lib/config";
import { SIGNIN_COOKIE, verifyAuthentication } from "@/lib/passkeys";
import { clientKey, rateLimit, refundRateLimit } from "@/lib/rate-limit";
import { PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS } from "@/lib/login-throttle";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { log, errorReason } from "@/lib/log";

// Sign in with a passkey (#537): the browser's answer, checked against the
// challenge the options call kept, from a passkey made on this host for an
// enabled account. A passkey asks for a PIN or a fingerprint, so the
// session counts as two-factor. Throttled per client like the password
// form.
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const throttleKey = clientKey(request, "login");
  const perClient = rateLimit(throttleKey, PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfterSeconds) } }
    );
  }
  const flow = await verifyFlow<{ challenge: string }>(request.cookies.get(SIGNIN_COOKIE)?.value, "passkey-signin");
  if (!flow) return NextResponse.json({ error: "That took too long. Try again." }, { status: 400 });
  const body = await request.json().catch(() => null);
  const { auth } = await readConfigInternal();
  let found;
  try {
    found = await verifyAuthentication(request, body?.response, flow.challenge, accountsOf(auth).filter((a) => a.enabled));
  } catch (e) {
    log.warn("a passkey sign-in didn't check out", { reason: errorReason(e) });
    found = null;
  }
  if (!found) {
    await recordSecurityEvent("signin.fail", eventMeta(request));
    return NextResponse.json({ error: "That passkey isn't one this site knows." }, { status: 401 });
  }
  refundRateLimit(throttleKey);
  await notePasskeyUse(found.account.id, found.passkey.id, found.counter);
  const { token } = await issueSession(request, found.account, { via: "passkey", twoFactor: true });
  await noteSignIn(found.account.id);
  notifySecurityEvent(await recordSecurityEvent("signin.ok", eventMeta(request, found.account.id)));
  const res = NextResponse.json({ ok: true, mustChangePassword: found.account.mustChangePassword });
  res.cookies.delete({ name: SIGNIN_COOKIE, path: "/api/auth/passkey" });
  setSessionCookie(res, request, token);
  return res;
}
