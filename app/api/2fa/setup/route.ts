import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { viewerOf } from "@/lib/api-auth";
import { requireRecentAuth } from "@/lib/reauth";
import { setTotpPendingSecret } from "@/lib/config";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

// Admin-only (gated by the /api/2fa proxy prefix and re-checked here). Begins
// TOTP enrollment (#198): mint a fresh secret, stash it as pending (not active
// until a code confirms it via /activate), and return the secret, the
// otpauth:// URI, and a scannable QR data-URI. The secret is only ever sent to
// the browser during this enrollment step.
const ISSUER = "CtrlCenter";

export async function POST(request: NextRequest) {
  const viewer = await viewerOf(request);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Never over an active factor (#384): activating would replace its secret
  // and recovery codes, silently breaking the authenticator and the codes the
  // admin saved. Checked before the step-up, which would only lead here.
  // The viewer's own second factor (#423).
  const { account } = viewer;
  if (account.totp.enabled) {
    return NextResponse.json(
      { error: "Two-factor authentication is already on — turn it off first to set up a new authenticator." },
      { status: 409 }
    );
  }
  // Step-up (#366): a stolen session enrolling its own device would lock
  // the owner out.
  const recent = await requireRecentAuth(request);
  if (!recent.ok) return recent.response;
  const secret = generateTotpSecret();
  await setTotpPendingSecret(account.id, secret);
  const uri = otpauthUri(secret, account.id, ISSUER);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return NextResponse.json({ secret, otpauthUri: uri, qr });
}
