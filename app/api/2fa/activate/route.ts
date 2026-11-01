import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { confirmTotpEnrollment, TotpStateError } from "@/lib/config";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import { verifyTotp, generateRecoveryCodes } from "@/lib/totp";
import { hashRecoveryCodes } from "@/lib/recovery-codes";
import { totpActivateSchema } from "@/lib/schema";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// Admin-only. Confirms a pending TOTP secret with a live code, then activates
// 2FA and returns freshly generated recovery codes — shown to the admin once,
// stored only as hashes (#198). Verification is throttled so the pending
// secret can't be brute-forced.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  const viewer = await viewerOf(request);
  // Any signed-in account, for its own (#423).
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  pruneRateLimit();
  const limited = rateLimit(clientKey(request, "2fa"), MAX_ATTEMPTS, WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  const parsed = totpActivateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  // The viewer's own enrollment (#423).
  const { account } = viewer;
  // Never over an active factor (#384), as /setup refuses too: a pending
  // secret left beside it (an older version minted one regardless) would
  // otherwise replace the live secret and recovery codes.
  if (account.totp.enabled) {
    return NextResponse.json(
      { error: "Two-factor authentication is already on — turn it off first to set up a new authenticator." },
      { status: 409 }
    );
  }
  if (!account.totp.pendingSecret) {
    return NextResponse.json(
      { error: "Start setup again — no enrollment in progress." },
      { status: 400 }
    );
  }
  if (!(await verifyTotp(account.totp.pendingSecret, parsed.data.code))) {
    return NextResponse.json(
      { error: "That code didn't match. Check your authenticator and try again." },
      { status: 401 }
    );
  }
  const recoveryCodes = generateRecoveryCodes(10);
  try {
    await confirmTotpEnrollment(account.id, account.totp.pendingSecret, await hashRecoveryCodes(recoveryCodes));
  } catch (e) {
    // The same checks as above, made inside the write queue (#399).
    if (e instanceof TotpStateError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  await recordSecurityEvent("totp.enabled", eventMeta(request, account.id));
  return NextResponse.json({ ok: true, recoveryCodes });
}
