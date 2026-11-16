import { NextRequest, NextResponse } from "next/server";
import { issueSession, setSessionCookie, signFlow, verifyFlow } from "@/lib/auth";
import { viewerOf } from "@/lib/api-auth";
import { findAccount, sessionNeedsTwoFactor } from "@/lib/accounts";
import { accountGroups } from "@/lib/account-groups";
import { AccountExistsError, addAccount, noteSignIn, readConfigInternal } from "@/lib/config";
import { log, errorReason } from "@/lib/log";
import { OIDC_FLOW_COOKIE, finishOidc, oidcReady, publicOrigin, type OidcFlow } from "@/lib/oidc";
import {
  OIDC_CODE_COOKIE,
  OIDC_CODE_TTL,
  failSignIn,
  flowCookieOptions,
  popupResult,
  type PendingOidcSignIn,
} from "@/lib/oidc-responses";
import { userSchema } from "@/lib/schema";
import { markReauth } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// Back from the provider (#504). The flow kept for this sign-in is checked
// (state, nonce, PKCE verifier), the code exchanged, and the identity
// matched to an account by sign-in name: one an admin added, or — only
// when the admin allows it — a new member. The provider's groups that are
// on the groups list (#505) go with the session. An account with its own
// second factor, which the provider didn't vouch for, still enters its
// code. A confirmation (purpose=reauth) must come back as the session's
// own account, and marks it confirmed.
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
  const meta = eventMeta(request, identity.username);

  if (flow.purpose === "reauth") {
    const viewer = await viewerOf(request, config.auth);
    if (!viewer || viewer.account.id !== identity.username) {
      await recordSecurityEvent("reauth.fail", meta);
      return failSignIn(request, "mismatch", { popup, next });
    }
    await markReauth(viewer.session.id);
    await recordSecurityEvent("reauth.ok", eventMeta(request, viewer.account.id));
    return popup ? popupResult(request, { ok: true }) : NextResponse.redirect(new URL(next, publicOrigin(request)), 303);
  }

  let account = findAccount(config.auth, identity.username);
  if (!account) {
    if (!o.createAccounts) {
      await recordSecurityEvent("signin.fail", meta);
      return failSignIn(request, "no-account", { popup, next, name: identity.username });
    }
    const made = userSchema.parse({
      id: identity.username,
      name: identity.name,
      role: "member",
      createdAt: new Date().toISOString(),
    });
    try {
      await addAccount(made);
      notifySecurityEvent(await recordSecurityEvent("account.created", meta, made.id));
    } catch (e) {
      if (!(e instanceof AccountExistsError)) throw e;
    }
    account = findAccount((await readConfigInternal()).auth, identity.username);
    if (!account) return failSignIn(request, "provider", { popup, next });
  }
  if (!account.enabled) {
    await recordSecurityEvent("signin.fail", meta);
    return failSignIn(request, "disabled", { popup, next });
  }
  const known = new Set(accountGroups(config));
  const groups = identity.groups.filter((g) => known.has(g));

  // The account's own second factor, when the provider didn't vouch for one.
  if (account.totp.enabled && !identity.twoFactor) {
    const pending: PendingOidcSignIn = { account: account.id, groups, next, popup };
    const url = new URL("/login", publicOrigin(request));
    url.searchParams.set("code", "provider");
    if (next !== "/") url.searchParams.set("next", next);
    if (popup) url.searchParams.set("popup", "1");
    const res = NextResponse.redirect(url, 303);
    res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
    res.cookies.set(
      OIDC_CODE_COOKIE,
      await signFlow(pending, "oidc-code", OIDC_CODE_TTL),
      flowCookieOptions(request, OIDC_CODE_TTL, "/api/auth/oidc/code")
    );
    return res;
  }

  const { token } = await issueSession(request, account, { via: "oidc", groups, twoFactor: identity.twoFactor });
  await noteSignIn(account.id);
  notifySecurityEvent(await recordSecurityEvent("signin.ok", eventMeta(request, account.id)));
  const res = popup
    ? popupResult(request, { ok: true })
    : NextResponse.redirect(
        new URL(sessionNeedsTwoFactor(account, { twoFactor: identity.twoFactor }) ? "/account" : next, publicOrigin(request)),
        303
      );
  res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
  setSessionCookie(res, request, token);
  return res;
}
