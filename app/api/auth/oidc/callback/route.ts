import { NextRequest, NextResponse } from "next/server";
import { verifyFlow } from "@/lib/auth";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { log, errorReason } from "@/lib/log";
import { OIDC_FLOW_COOKIE, finishOidc, oidcReady, publicOrigin, type OidcFlow } from "@/lib/oidc";
import { failSignIn, popupResult } from "@/lib/oidc-responses";
import { completeProviderSignIn, listedGroups, providerAccount } from "@/lib/provider-signin";
import { markReauth } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// Back from the provider (#504). The flow kept for this sign-in is checked
// (state, nonce, PKCE verifier), the code exchanged, and the identity
// matched to an account by sign-in name (lib/provider-signin.ts). A
// confirmation (purpose=reauth) must come back as the session's own
// account, and marks it confirmed.
export async function GET(request: NextRequest) {
  const flow = await verifyFlow<OidcFlow>(request.cookies.get(OIDC_FLOW_COOKIE)?.value, "oidc");
  if (!flow) return failSignIn(request, "expired");
  const { popup, next } = flow;
  const config = await readConfigInternal();
  const o = config.settings.signIn.oidc;
  if (!oidcReady(o)) return failSignIn(request, "off", { popup, next });
  // The provider said no (the person cancelled, or isn't allowed this client).
  if (request.nextUrl.searchParams.get("error")) return failSignIn(request, "denied", { popup, next });

  let identity;
  try {
    identity = await finishOidc(o, request, flow);
  } catch (e) {
    log.warn("sign-in through the provider failed", { reason: errorReason(e) });
    return failSignIn(request, "provider", { popup, next });
  }
  if (!identity.username) return failSignIn(request, "name", { popup, next });

  if (flow.purpose === "reauth") {
    const viewer = await viewerOf(request, config.auth);
    if (!viewer || viewer.account.id !== identity.username) {
      await recordSecurityEvent("reauth.fail", eventMeta(request, identity.username));
      return failSignIn(request, "mismatch", { popup, next });
    }
    await markReauth(viewer.session.id);
    await recordSecurityEvent("reauth.ok", eventMeta(request, viewer.account.id));
    return popup ? popupResult(request, { ok: true }) : NextResponse.redirect(new URL(next, publicOrigin(request)), 303);
  }

  const found = await providerAccount(request, config, identity, o.createAccounts);
  if ("error" in found) return failSignIn(request, found.error, { popup, next, name: found.name });
  return completeProviderSignIn(request, found.account, {
    via: "oidc",
    groups: listedGroups(config, identity.groups),
    twoFactor: identity.twoFactor,
    next,
    popup,
  });
}
