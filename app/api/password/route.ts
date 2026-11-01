import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  hashPassword,
  issueSession,
  setSessionCookie,
} from "@/lib/auth";
import { setAccountPassword } from "@/lib/config";
import { usesEnvPassword } from "@/lib/accounts";
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
  const viewer = await viewerOf(request);
  if (!viewer?.isAdmin) {
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
  // The viewer's own account (#423): its stored password, else, for the
  // founding admin, ADMIN_PASSWORD.
  const { account } = viewer;
  const ok = account.passwordHash
    ? await verifyPasswordHash(current, account.passwordHash, account.passwordSalt)
    : usesEnvPassword(account) && verifyEnvPassword(current);
  if (!ok) {
    await recordSecurityEvent("password.fail", eventMeta(request, account.id));
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
  await setAccountPassword(account.id, hash, salt);

  // This account's other sessions end — the token was signed against the
  // old hash — and everyone else stays signed in (#423).
  await revokeSessions(undefined, account.id);
  const { token } = await issueSession(request, { id: account.id, passwordHash: hash });
  notifySecurityEvent(await recordSecurityEvent("password.changed", eventMeta(request, account.id)));
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, request, token);
  return response;
}
