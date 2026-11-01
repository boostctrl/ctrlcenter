import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { requireRecentAuth } from "@/lib/reauth";
import { disableTotp, clearAllowActions } from "@/lib/config";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import { verifyTotpOnce } from "@/lib/totp";
import { verifyRecoveryCode } from "@/lib/recovery-codes";
import { totpDisableSchema } from "@/lib/schema";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// Admin-only. Turning 2FA off requires a current authenticator code (or a
// recovery code), like changing the password requires the current one — so a
// hijacked session that lacks the device can't quietly disable the second
// factor (#198).
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  const viewer = await viewerOf(request);
  // Any signed-in account, for its own (#423).
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Step-up (#366): the code below proves the device; a recent confirmation
  // proves the password too.
  const recent = await requireRecentAuth(request);
  if (!recent.ok) return recent.response;
  pruneRateLimit();
  const limited = rateLimit(clientKey(request, "2fa"), MAX_ATTEMPTS, WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  const parsed = totpDisableSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  // The viewer's own second factor (#423).
  const { account } = viewer;
  if (!account.totp.enabled) {
    return NextResponse.json({ ok: true }); // already off
  }
  const { code } = parsed.data;
  const ok =
    (await verifyTotpOnce(account.totp.secret, code)) ||
    (await verifyRecoveryCode(code, account.totp.recoveryCodes)).ok;
  if (!ok) {
    return NextResponse.json(
      { error: "That code didn't match." },
      { status: 401 }
    );
  }
  await disableTotp(account.id);
  // Write actions need the second factor (#367): off with it, and said so.
  const actionsDisabled = await clearAllowActions();
  notifySecurityEvent(await recordSecurityEvent("totp.disabled", eventMeta(request, account.id)));
  return NextResponse.json({ ok: true, actionsDisabled });
}
