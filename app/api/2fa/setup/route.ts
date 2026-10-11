import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { isAdminRequest } from "@/lib/api-auth";
import { requireRecentAuth } from "@/lib/reauth";
import { setTotpPendingSecret } from "@/lib/config";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

// Admin-only (gated by the /api/2fa proxy prefix and re-checked here). Begins
// TOTP enrollment (#198): mint a fresh secret, stash it as pending (not active
// until a code confirms it via /activate), and return the secret, the
// otpauth:// URI, and a scannable QR data-URI. The secret is only ever sent to
// the browser during this enrollment step.
const ISSUER = "CtrlCenter";
const ACCOUNT = "admin";

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Step-up (#366): a stolen session enrolling its own device would lock
  // the owner out.
  const recent = await requireRecentAuth(request);
  if (!recent.ok) return recent.response;
  const secret = generateTotpSecret();
  await setTotpPendingSecret(secret);
  const uri = otpauthUri(secret, ACCOUNT, ISSUER);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return NextResponse.json({ secret, otpauthUri: uri, qr });
}
