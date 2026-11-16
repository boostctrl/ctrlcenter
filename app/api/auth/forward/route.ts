import { NextRequest, NextResponse } from "next/server";
import { sessionTokenFrom, verifySession } from "@/lib/auth";
import { readConfigInternal } from "@/lib/config";
import { SIGNED_OUT_COOKIE, forwardIdentity } from "@/lib/forward-auth";
import { publicOrigin } from "@/lib/oidc";
import { failSignIn } from "@/lib/oidc-responses";
import { completeProviderSignIn, listedGroups, providerAccount } from "@/lib/provider-signin";
import { revokeSession } from "@/lib/sessions";
import { safeNextPath } from "@/lib/urls";

// Sign in from the reverse proxy's headers (#504): the proxy (Authelia,
// Authentik, oauth2-proxy) has signed the person in and says who it is,
// believed only from the proxy's own address (lib/forward-auth.ts). The
// proxy (lib's middleware) sends a page request here when the headers name
// someone the browser isn't signed in as; the sign-in page's "Continue as"
// button does too, after signing out. A session for another account is
// ended first. Public: signing in is what it's for.
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), publicOrigin(request), "/");
  const config = await readConfigInternal();
  const fa = config.settings.signIn.forwardAuth;
  const identity = forwardIdentity(request.headers, fa);
  if (!identity) return failSignIn(request, fa.enabled ? "no-header" : "off", { next });
  const live = await verifySession(sessionTokenFrom(request.cookies), config.auth);
  let res: NextResponse;
  if (live && live.account.id === identity.username) {
    res = NextResponse.redirect(new URL(next, publicOrigin(request)), 303);
  } else {
    const found = await providerAccount(request, config, { ...identity, name: "" }, fa.createAccounts);
    if ("error" in found) return failSignIn(request, found.error, { next, name: found.name ?? identity.raw });
    if (live) await revokeSession(live.session.id);
    res = await completeProviderSignIn(request, found.account, {
      via: "forward",
      groups: listedGroups(config, identity.groups),
      twoFactor: fa.enforcesTwoFactor,
      next,
      popup: false,
    });
  }
  res.cookies.delete(SIGNED_OUT_COOKIE);
  return res;
}
