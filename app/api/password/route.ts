import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  hashPassword,
  issueSession,
  setSessionCookie,
} from "@/lib/auth";
import { readConfigInternal, setPasswordHash } from "@/lib/config";
import { passwordChangeSchema } from "@/lib/schema";
import { revokeSessions } from "@/lib/sessions";
import { requireRecentAuth } from "@/lib/reauth";
import { clientKey, pruneRateLimit, rateLimit, refundRateLimit } from "@/lib/rate-limit";
import { PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS } from "@/lib/login-throttle";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// Admin-only (gated by the proxy matcher and re-checked here). Changing the
// password still requires the current one as defense-in-depth, even with a
// valid session.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Step-up (#366): the current password below proves the password; with a
  // second factor on, a recent confirmation proves the device too.
  const recent = await requireRecentAuth(request);
  if (!recent.ok) return recent.response;
  const body = await request.json().catch(() => null);
  const parsed = passwordChangeSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.flatten().fieldErrors.next?.[0] ?? "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { current, next } = parsed.data;

  // The current-password check is a password check: throttled per client on
  // the confirmation's budget and logged like one (#392), so a session inside
  // its step-up window isn't a quiet place to guess the password.
  pruneRateLimit();
  const throttleKey = clientKey(request, "reauth");
  const limited = rateLimit(throttleKey, PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  const { auth } = await readConfigInternal();
  const ok = auth.passwordHash
    ? await verifyPasswordHash(current, auth.passwordHash, auth.passwordSalt)
    : verifyEnvPassword(current);
  if (!ok) {
    await recordSecurityEvent("password.fail", eventMeta(request));
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 403 }
    );
  }
  refundRateLimit(throttleKey);

  // Not the one just typed, and not the container's ADMIN_PASSWORD either:
  // a stored password that equals the env one changes nothing (#369).
  if (next === current || verifyEnvPassword(next)) {
    return NextResponse.json(
      { error: "Choose a password you haven't used here before" },
      { status: 400 }
    );
  }
  const { hash, salt } = await hashPassword(next);
  await setPasswordHash(hash, salt);

  // Changing the password revokes every existing session (the key mixes in the
  // hash, and the records go too). Reissue this admin a fresh cookie bound to
  // the new hash so they stay signed in while any other sessions are
  // invalidated.
  await revokeSessions();
  const { token } = await issueSession(request, hash);
  notifySecurityEvent(await recordSecurityEvent("password.changed", eventMeta(request)));
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, request, token);
  return response;
}
