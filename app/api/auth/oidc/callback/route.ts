import { NextRequest, NextResponse } from "next/server";
import { verifyFlow } from "@/lib/auth";
import { viewerOf } from "@/lib/api-auth";
import { ProviderLinkTakenError, readConfigInternal, setProviderLink } from "@/lib/config";
import { log, errorReason } from "@/lib/log";
import { OIDC_FLOW_COOKIE, finishOidc, oidcReady, publicOrigin, type OidcFlow } from "@/lib/oidc";
import { failLink, failSignIn, popupResult } from "@/lib/oidc-responses";
import { completeProviderSignIn, listedGroups, oidcAccount } from "@/lib/provider-signin";
import { REAUTH_WINDOW_MS } from "@/lib/reauth";
import { markReauth } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// Back from the provider (#504). The flow kept for this sign-in is checked
// (state, nonce, PKCE verifier) and the code exchanged. The identity is the
// provider's issuer and subject (#555), never the username:
// - a sign-in reaches the account connected to that identity
//   (lib/provider-signin.ts);
// - a confirmation (purpose=reauth) must come back as the identity the
//   session's account is connected to, and marks it confirmed;
// - connecting (purpose=link) ties the session's own account, confirmed
//   just now, to the identity, unless another account here holds it.
export async function GET(request: NextRequest) {
  const flow = await verifyFlow<OidcFlow>(request.cookies.get(OIDC_FLOW_COOKIE)?.value, "oidc");
  if (!flow) return failSignIn(request, "expired");
  const { popup, next, purpose } = flow;
  const fail = (error: Parameters<typeof failSignIn>[1]) =>
    purpose === "link" ? failLink(request, error) : failSignIn(request, error, { popup, next });
  const config = await readConfigInternal();
  const o = config.settings.signIn.oidc;
  if (!oidcReady(o)) return fail("off");
  // The provider said no (the person cancelled, or isn't allowed this client).
  if (request.nextUrl.searchParams.get("error")) return fail("denied");

  let identity;
  try {
    identity = await finishOidc(o, request, flow);
  } catch (e) {
    log.warn("sign-in through the provider failed", { reason: errorReason(e) });
    return fail("provider");
  }
  if (!identity.iss || !identity.sub) return fail("provider");
  const same = (link: { iss: string; sub: string } | null | undefined) =>
    !!link && link.iss === identity.iss && link.sub === identity.sub;

  if (purpose === "link") {
    const viewer = await viewerOf(request, config.auth);
    if (!viewer || viewer.token || Date.now() - viewer.session.reauthAt > REAUTH_WINDOW_MS) return fail("expired");
    try {
      await setProviderLink(viewer.account.id, {
        iss: identity.iss,
        sub: identity.sub,
        name: identity.username ?? "",
        linkedAt: Date.now(),
      });
    } catch (e) {
      if (e instanceof ProviderLinkTakenError) return fail("in-use");
      throw e;
    }
    notifySecurityEvent(
      await recordSecurityEvent("provider.linked", eventMeta(request, viewer.account.id), identity.username ?? identity.sub)
    );
    const url = new URL("/account", publicOrigin(request));
    url.searchParams.set("provider", "connected");
    const res = NextResponse.redirect(url, 303);
    res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
    return res;
  }

  if (purpose === "reauth") {
    const viewer = await viewerOf(request, config.auth);
    if (!viewer || !same(viewer.account.provider)) {
      await recordSecurityEvent("reauth.fail", eventMeta(request, viewer?.account.id));
      return fail("mismatch");
    }
    await markReauth(viewer.session.id);
    await recordSecurityEvent("reauth.ok", eventMeta(request, viewer.account.id));
    return popup ? popupResult(request, { ok: true }) : NextResponse.redirect(new URL(next, publicOrigin(request)), 303);
  }

  const found = await oidcAccount(request, config, identity, o.createAccounts);
  if ("error" in found) return failSignIn(request, found.error, { popup, next, name: found.name });
  return completeProviderSignIn(request, found.account, {
    via: "oidc",
    groups: listedGroups(config, identity.groups),
    twoFactor: identity.twoFactor,
    next,
    popup,
  });
}
