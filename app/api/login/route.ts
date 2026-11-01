import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordConfigured,
  NO_PASSWORD_MESSAGE,
  issueSession,
  setSessionCookie,
} from "@/lib/auth";
import { readConfigInternal } from "@/lib/config";
import { verifyCredentials } from "@/lib/credentials";
import { rateLimit, refundRateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import {
  PER_CLIENT_MAX_ATTEMPTS,
  WINDOW_MS,
  chargeWrongCode,
  chargeWrongPassword,
  codeChecksPausedFor,
} from "@/lib/login-throttle";
import { isSameOriginRequest } from "@/lib/api-auth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { CODES_LOCKED, notifySecurityEvent } from "@/lib/security-alerts";

// Allow a small burst of attempts per client, then lock that source out for the
// window — the primary gate, checked before any password hashing. The shared
// budgets in lib/login-throttle back it up against a run spread over many
// addresses: wrong passwords (counted only after a wrong password, so a
// stranger can't lock the real admin out, #158) and wrong codes (#392).
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
  const perClient = rateLimit(throttleKey, PER_CLIENT_MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
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
  // While the shared wrong-code budget is spent, no code is checked at all, a
  // correct one included (#392): whoever spent it has the password, and the
  // admin's own sign-in waiting a few minutes is the lesser harm.
  const sentCode = typeof body?.totp === "string" && body.totp.trim() !== "";
  if (sentCode && auth.totp.enabled) {
    const paused = codeChecksPausedFor();
    if (paused > 0) {
      return NextResponse.json(
        { error: "Too many wrong codes. Try again later.", totpRequired: true },
        { status: 429, headers: { "Retry-After": String(paused) } }
      );
    }
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
    // Charge the shared wrong-password budget only here — a correct password
    // never reaches this branch, so the budget can't be used to deny the
    // legitimate admin. It still bounds a distributed brute force: once too
    // many failures land in the window, further wrong guesses are refused
    // regardless of source (#158).
    const global = chargeWrongPassword();
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
    if (result.reason === "totp-required") {
      // The form's second step, not a failure: the per-client charge goes
      // back (the client's strikes stay), so a two-factor sign-in costs one
      // attempt rather than two and can't lock its own admin out (#392).
      refundRateLimit(throttleKey, { keepStrikes: true });
    } else if (chargeWrongCode()) {
      // Password right, code wrong, and that one spent the shared wrong-code
      // budget: whoever is guessing has the password. Code checks pause (see
      // above); say so, once.
      notifySecurityEvent(await recordSecurityEvent("signin.locked", eventMeta(request), CODES_LOCKED));
    }
    // A wrong code never touches the wrong-password budget, so someone who
    // has the password but not the device can't lock the real admin out of
    // password sign-in by spamming codes. A missing code signals the client
    // to collect one, without revealing whether the password was right vs
    // wrong to a caller who never sends a code.
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
