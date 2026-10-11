import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordConfigured,
  NO_PASSWORD_MESSAGE,
  issueSession,
  setSessionCookie,
} from "@/lib/auth";
import { readConfigInternal } from "@/lib/config";
import { verifyCredentials } from "@/lib/credentials";
import {
  rateLimit,
  refundRateLimit,
  pruneRateLimit,
  clientKey,
} from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/api-auth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// Allow a small burst of attempts per client, then lock that source out for the
// window — the primary gate, checked before any password hashing. A separate,
// higher global cap backstops a distributed brute force, but it counts only
// FAILED attempts and is enforced only after a wrong password: a correct
// password is never charged against it, so an attacker can't exhaust the shared
// budget to lock the real admin out of login (#158).
const MAX_ATTEMPTS = 5;
const GLOBAL_MAX_ATTEMPTS = 50;
const WINDOW_MS = 5 * 60 * 1000;
// Clients whose lockout was already logged this window (#368).
const lockedKeys = new Set<string>();

export async function POST(request: NextRequest) {
  // A cross-site page must not be able to sign the browser in (login CSRF) —
  // nor spend this client's attempt budget on its behalf.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  pruneRateLimit();
  // Per-client throttle first — checked and consumed before any PBKDF2 work, so
  // one source can't run unbounded password hashing, and behind the documented
  // reverse proxy the key is the real client IP (not the spoofable X-Forwarded-For
  // prefix). This is the gate that stops a single attacker; the global backstop
  // below only counts failures so it can't lock the real admin out.
  const throttleKey = clientKey(request, "login");
  const perClient = rateLimit(throttleKey, MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  if (!perClient.allowed) {
    // Once per lockout, not per refused request: the first refusal tips it.
    if (perClient.retryAfterSeconds > 0 && !lockedKeys.has(throttleKey)) {
      lockedKeys.add(throttleKey);
      setTimeout(() => lockedKeys.delete(throttleKey), WINDOW_MS).unref?.();
      notifySecurityEvent(await recordSecurityEvent("signin.locked", eventMeta(request)));
    }
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(perClient.retryAfterSeconds) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.password !== "string") {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Prefer a password set through the UI (stored hash); otherwise fall back to
  // the ADMIN_PASSWORD env var.
  const { auth } = await readConfigInternal();
  if (!adminPasswordConfigured(auth)) {
    return NextResponse.json({ error: NO_PASSWORD_MESSAGE }, { status: 503 });
  }
  // The password, and the code when the second factor is on (#198), through
  // the one credential check the step-up confirmation shares (#366).
  const result = await verifyCredentials(auth, body?.password, body?.totp);
  if (!result.ok && result.reason !== "totp-required") {
    // A wrong password or code, in the audit log (#368); a missing code is
    // the form's second step, not a failure.
    await recordSecurityEvent("signin.fail", eventMeta(request));
  }
  if (!result.ok && result.reason === "password") {
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
  if (!result.ok) {
    // Password right, code missing or wrong. The per-client throttle above
    // already bounds guesses of the 6-digit code — a wrong code doesn't touch
    // the global backstop, so someone who has the password but not the device
    // can't lock the real admin out by spamming codes. A missing code signals
    // the client to collect one, without revealing whether the password was
    // right vs wrong to a caller who never sends a code.
    return NextResponse.json(
      {
        error: result.reason === "totp-required" ? "Enter your authentication code" : "Invalid authentication code",
        totpRequired: true,
      },
      { status: 401 }
    );
  }

  // Fully signed in (password, and code when 2FA is on): refund this attempt's
  // per-client charge, so only failures count toward the lockout.
  refundRateLimit(throttleKey);

  // Bind the token to the current password hash so a later password change
  // revokes it (see proxy.ts / verifySessionToken), and record the session
  // so logout, the idle timeout and "sign out everywhere" can end it (#365).
  const { token } = await issueSession(request, auth.passwordHash);
  // In the audit log, and out through the channels when the address is new.
  notifySecurityEvent(await recordSecurityEvent("signin.ok", eventMeta(request)));
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, request, token);
  return response;
}
