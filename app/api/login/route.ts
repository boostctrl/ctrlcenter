import { NextRequest, NextResponse } from "next/server";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { readConfigInternal, setTotpRecoveryCodes } from "@/lib/config";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import { verifyRecoveryCode } from "@/lib/recovery-codes";

// Allow a small burst of attempts per client, then lock that source out for the
// window — the primary gate, checked before any password hashing. A separate,
// higher global cap backstops a distributed brute force, but it counts only
// FAILED attempts and is enforced only after a wrong password: a correct
// password is never charged against it, so an attacker can't exhaust the shared
// budget to lock the real admin out of login (#158).
const MAX_ATTEMPTS = 5;
const GLOBAL_MAX_ATTEMPTS = 50;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  pruneRateLimit();
  // Per-client throttle first — checked and consumed before any PBKDF2 work, so
  // one source can't run unbounded password hashing, and behind the documented
  // reverse proxy the key is the real client IP (not the spoofable X-Forwarded-For
  // prefix). This is the gate that stops a single attacker; the global backstop
  // below only counts failures so it can't lock the real admin out.
  const perClient = rateLimit(clientKey(request, "login"), MAX_ATTEMPTS, WINDOW_MS);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(perClient.retryAfterSeconds) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const password = body?.password;
  const totpCode = typeof body?.totp === "string" ? body.totp : "";

  if (typeof password !== "string") {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Prefer a password set through the UI (stored hash); otherwise fall back to
  // the ADMIN_PASSWORD env var.
  const { auth } = await readConfigInternal();
  const ok = auth.passwordHash
    ? await verifyPasswordHash(password, auth.passwordHash, auth.passwordSalt)
    : verifyEnvPassword(password);

  if (!ok) {
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

  // Password is correct. If the second factor is on, the code must also check
  // out before a session is issued (#198). The per-client throttle above
  // already bounds guesses of the 6-digit code — a wrong code doesn't touch
  // the global backstop, so someone who has the password but not the device
  // can't lock the real admin out by spamming codes.
  if (auth.totp.enabled) {
    if (totpCode.trim() === "") {
      // Signal the client to collect the code, without revealing whether the
      // password was right vs wrong to a caller who never sends a code.
      return NextResponse.json(
        { error: "Enter your authentication code", totpRequired: true },
        { status: 401 }
      );
    }
    const codeOk = await verifyTotp(auth.totp.secret, totpCode);
    if (!codeOk) {
      // Not a valid time code — try it as a one-time recovery code, spending
      // it on success so it can't be reused.
      const match = await verifyRecoveryCode(totpCode, auth.totp.recoveryCodes);
      if (!match.ok) {
        return NextResponse.json(
          { error: "Invalid authentication code", totpRequired: true },
          { status: 401 }
        );
      }
      await setTotpRecoveryCodes(match.remaining);
    }
  }

  // Bind the token to the current password hash so a later password change
  // revokes it (see proxy.ts / verifySessionToken).
  const token = await createSessionToken(auth.passwordHash);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(request)
  );
  return response;
}
