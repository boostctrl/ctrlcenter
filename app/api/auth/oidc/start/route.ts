import { NextRequest, NextResponse } from "next/server";
import { signFlow } from "@/lib/auth";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { log, errorReason } from "@/lib/log";
import { OIDC_FLOW_COOKIE, OIDC_FLOW_TTL, oidcReady, publicOrigin, startOidc } from "@/lib/oidc";
import { failSignIn, flowCookieOptions } from "@/lib/oidc-responses";
import { safeNextPath } from "@/lib/urls";

// Leave for the provider (#504): a sign-in from the form's button, or —
// with purpose=reauth, from a popup the page opened — a fresh sign-in at
// the provider to confirm a session it started (#366). Public: signing in
// is what it's for. The flow to check on the way back goes in a signed
// cookie (lib/oidc.ts).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const purpose = params.get("purpose") === "reauth" ? "reauth" : "signin";
  const popup = params.get("popup") === "1";
  const next = safeNextPath(params.get("next"), publicOrigin(request), "/");
  const config = await readConfigInternal();
  const o = config.settings.signIn.oidc;
  if (!oidcReady(o)) return failSignIn(request, "off", { popup, next });
  // A confirmation is of the session asking for it.
  if (purpose === "reauth" && !(await viewerOf(request, config.auth))) {
    return failSignIn(request, "expired", { popup, next });
  }
  try {
    const { url, flow } = await startOidc(o, request, { next, purpose, popup });
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(OIDC_FLOW_COOKIE, await signFlow(flow, "oidc", OIDC_FLOW_TTL), flowCookieOptions(request, OIDC_FLOW_TTL));
    return res;
  } catch (e) {
    log.warn("couldn't reach the sign-in provider", { reason: errorReason(e) });
    return failSignIn(request, "provider", { popup, next });
  }
}
