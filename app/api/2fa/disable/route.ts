import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, disableTotp } from "@/lib/config";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import { verifyRecoveryCode } from "@/lib/recovery-codes";
import { totpDisableSchema } from "@/lib/schema";

// Admin-only. Turning 2FA off requires a current authenticator code (or a
// recovery code), like changing the password requires the current one — so a
// hijacked session that lacks the device can't quietly disable the second
// factor (#198).
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
  const parsed = totpDisableSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { auth } = await readConfigInternal();
  if (!auth.totp.enabled) {
    return NextResponse.json({ ok: true }); // already off
  }
  const { code } = parsed.data;
  const ok =
    (await verifyTotp(auth.totp.secret, code)) ||
    (await verifyRecoveryCode(code, auth.totp.recoveryCodes)).ok;
  if (!ok) {
    return NextResponse.json(
      { error: "That code didn't match." },
      { status: 401 }
    );
  }
  await disableTotp();
  return NextResponse.json({ ok: true });
}
