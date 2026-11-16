import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { signFlow } from "@/lib/auth";
import { readConfigInternal } from "@/lib/config";
import { PASSKEY_CHALLENGE_TTL, REGISTER_COOKIE, registrationOptions } from "@/lib/passkeys";
import { flowCookieOptions } from "@/lib/oidc-responses";
import { requireRecentAuth } from "@/lib/reauth";

// The start of adding a passkey (#537) to the asking account: the options
// for the browser, the challenge kept in a signed cookie. Adding one opens
// a way in, so it takes a recent confirmation, asked here before the
// browser's own prompt.
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer || viewer.token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const options = await registrationOptions(request, viewer.account, config.settings.title);
  const res = NextResponse.json(options);
  res.cookies.set(
    REGISTER_COOKIE,
    await signFlow({ challenge: options.challenge, account: viewer.account.id }, "passkey-add", PASSKEY_CHALLENGE_TTL),
    flowCookieOptions(request, PASSKEY_CHALLENGE_TTL, "/api/passkeys")
  );
  return res;
}
