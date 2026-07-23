import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, activateTotp } from "@/lib/config";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import { verifyTotp, generateRecoveryCodes } from "@/lib/totp";
import { hashRecoveryCodes } from "@/lib/recovery-codes";
import { totpActivateSchema } from "@/lib/schema";

// Admin-only. Confirms a pending TOTP secret with a live code, then activates
// 2FA and returns freshly generated recovery codes — shown to the admin once,
// stored only as hashes (#198). Verification is throttled so the pending
// secret can't be brute-forced.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
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
  const { auth } = await readConfigInternal();
  if (!auth.totp.pendingSecret) {
    return NextResponse.json(
      { error: "Start setup again — no enrollment in progress." },
      { status: 400 }
    );
  }
  if (!(await verifyTotp(auth.totp.pendingSecret, parsed.data.code))) {
    return NextResponse.json(
      { error: "That code didn't match. Check your authenticator and try again." },
      { status: 401 }
    );
  }
  const recoveryCodes = generateRecoveryCodes(10);
  await activateTotp(auth.totp.pendingSecret, await hashRecoveryCodes(recoveryCodes));
  return NextResponse.json({ ok: true, recoveryCodes });
}
