import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, sessionTokenFrom, verifySession } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { revokeSession } from "@/lib/sessions";
import { oidcEndSessionUrl, oidcReady } from "@/lib/oidc";
import { log, errorReason } from "@/lib/log";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

export async function POST(request: NextRequest) {
  // Same-origin only, so a cross-site page can't sign the admin out.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // End the session itself, not just the cookie: a copy of the token taken
  // before logout must not keep working (#365).
  const token = sessionTokenFrom(request.cookies);
  // Where to go next: the provider's sign-out page, for a session that came
  // from a provider set to sign out there too (#504).
  let redirect: string | null = null;
  if (token) {
    const { auth, settings } = await readConfigInternal();
    const live = await verifySession(token, auth);
    if (live) {
      await revokeSession(live.session.id);
      await recordSecurityEvent("signout", eventMeta(request, live.account.id));
      const o = settings.signIn.oidc;
      if (live.session.via === "oidc" && o.endProviderSession && oidcReady(o)) {
        redirect = await oidcEndSessionUrl(o, request).catch((e) => {
          log.warn("couldn't find the provider's sign-out page", { reason: errorReason(e) });
          return null;
        });
      }
    }
  }
  const response = NextResponse.json({ ok: true, ...(redirect ? { redirect } : {}) });
  clearSessionCookie(response);
  return response;
}
