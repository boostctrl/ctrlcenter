import { NextRequest, NextResponse } from "next/server";
import { signFlow } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/api-auth";
import { PASSKEY_CHALLENGE_TTL, SIGNIN_COOKIE, authenticationOptions } from "@/lib/passkeys";
import { flowCookieOptions } from "@/lib/oidc-responses";

// The start of signing in with a passkey (#537): the options for the
// browser — any passkey for this host — and the challenge, kept in a
// signed cookie. Public: signing in is what it's for.
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const options = await authenticationOptions(request);
  const res = NextResponse.json(options);
  res.cookies.set(
    SIGNIN_COOKIE,
    await signFlow({ challenge: options.challenge }, "passkey-signin", PASSKEY_CHALLENGE_TTL),
    flowCookieOptions(request, PASSKEY_CHALLENGE_TTL, "/api/auth/passkey")
  );
  return res;
}
