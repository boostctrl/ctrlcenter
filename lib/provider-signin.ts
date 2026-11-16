// What signing in through a provider and through the reverse proxy's
// headers share (#504), once each knows who the person is: the account of
// that name — or a new member, when the admin allows it — the provider's
// groups that are on the groups list (#505), and then either the session,
// or a stop for the account's own second factor when the provider didn't
// vouch for one.
import { NextResponse, type NextRequest } from "next/server";
import { issueSession, setSessionCookie, signFlow } from "./auth";
import { accountsOf, findAccount, sessionNeedsTwoFactor } from "./accounts";
import { accountGroups } from "./account-groups";
import { AccountExistsError, addAccount, noteSignIn, readConfigInternal } from "./config";
import { OIDC_FLOW_COOKIE, publicOrigin, type OidcIdentity } from "./oidc";
import { popupResult, type OidcFailure } from "./oidc-responses";
import { userSchema, type Config, type User } from "./schema";
import type { SessionVia } from "./sessions";
import { eventMeta, recordSecurityEvent } from "./security-events";
import { notifySecurityEvent } from "./security-alerts";

// A sign-in that passed its provider and waits for the account's own second
// factor, for five minutes, in a signed cookie only /api/auth/code reads.
export const SIGNIN_CODE_COOKIE = "ctrlcenter_signin_code";
export const SIGNIN_CODE_PATH = "/api/auth/code";
export const SIGNIN_CODE_TTL = 300;
export type PendingSignIn = { account: string; groups: string[]; next: string; popup: boolean; via: SessionVia };

export type ProviderIdentity = { username: string | null; name: string; groups: string[] };

// The account an OpenID Connect identity signs in to (#555): the one
// connected to it, by issuer and subject — never by username, which some
// providers let people choose. With none connected: a new member, connected
// as it is made, when the admin allows it and the name is free here; else
// refused. An account that exists is never taken over by name: its owner
// connects it from its own page.
export async function oidcAccount(
  request: NextRequest,
  config: Config,
  identity: OidcIdentity,
  createAccounts: boolean
): Promise<{ account: User } | { error: OidcFailure; name?: string }> {
  if (!identity.iss || !identity.sub) return { error: "provider" };
  const meta = eventMeta(request, identity.username ?? undefined);
  const linked = accountsOf(config.auth).find((u) => u.provider?.iss === identity.iss && u.provider?.sub === identity.sub);
  if (linked) {
    if (linked.enabled) return { account: linked };
    await recordSecurityEvent("signin.fail", meta);
    return { error: "disabled" };
  }
  if (!createAccounts) {
    await recordSecurityEvent("signin.fail", meta);
    return { error: "not-linked" };
  }
  if (!identity.username) return { error: "name" };
  if (findAccount(config.auth, identity.username)) {
    await recordSecurityEvent("signin.fail", meta);
    return { error: "taken", name: identity.username };
  }
  const made = userSchema.parse({
    id: identity.username,
    name: identity.name,
    role: "member",
    createdAt: new Date().toISOString(),
    provider: { iss: identity.iss, sub: identity.sub, name: identity.username, linkedAt: Date.now() },
  });
  try {
    await addAccount(made);
    notifySecurityEvent(await recordSecurityEvent("account.created", meta, made.id));
  } catch (e) {
    // Two first sign-ins at once: the other made it.
    if (!(e instanceof AccountExistsError)) throw e;
  }
  const account = accountsOf((await readConfigInternal()).auth).find(
    (u) => u.provider?.iss === identity.iss && u.provider?.sub === identity.sub
  );
  return account ? { account } : { error: "taken", name: identity.username };
}

// The account the reverse proxy's headers sign in to (#504), or why there
// is none: by name, which is the proxy's own identity for the person.
export async function providerAccount(
  request: NextRequest,
  config: Config,
  identity: ProviderIdentity,
  createAccounts: boolean
): Promise<{ account: User } | { error: OidcFailure; name?: string }> {
  if (!identity.username) return { error: "name" };
  const meta = eventMeta(request, identity.username);
  let account = findAccount(config.auth, identity.username);
  if (!account) {
    if (!createAccounts) {
      await recordSecurityEvent("signin.fail", meta);
      return { error: "no-account", name: identity.username };
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
    if (!account) return { error: "provider" };
  }
  if (!account.enabled) {
    await recordSecurityEvent("signin.fail", meta);
    return { error: "disabled" };
  }
  return { account };
}

// The provider's groups that are on the groups list.
export function listedGroups(config: Config, groups: readonly string[]): string[] {
  const known = new Set(accountGroups(config));
  return groups.filter((g) => known.has(g));
}

// The end of a provider's sign-in: the code step when the account has its
// own second factor and the provider didn't vouch for one, else the session
// and on to `next` (the account page first when a second factor is still
// to be set up), or the popup's answer.
export async function completeProviderSignIn(
  request: NextRequest,
  account: User,
  opts: { via: SessionVia; groups: string[]; twoFactor: boolean; next: string; popup: boolean }
): Promise<NextResponse> {
  const { via, groups, twoFactor, next, popup } = opts;
  if (account.totp.enabled && !twoFactor) {
    const pending: PendingSignIn = { account: account.id, groups, next, popup, via };
    const url = new URL("/login", publicOrigin(request));
    url.searchParams.set("code", "provider");
    if (next !== "/") url.searchParams.set("next", next);
    if (popup) url.searchParams.set("popup", "1");
    const res = NextResponse.redirect(url, 303);
    res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
    res.cookies.set(SIGNIN_CODE_COOKIE, await signFlow(pending, "signin-code", SIGNIN_CODE_TTL), {
      httpOnly: true,
      secure: publicOrigin(request).startsWith("https:"),
      sameSite: "lax",
      path: SIGNIN_CODE_PATH,
      maxAge: SIGNIN_CODE_TTL,
    });
    return res;
  }
  const { token } = await issueSession(request, account, { via, groups, twoFactor });
  await noteSignIn(account.id);
  notifySecurityEvent(await recordSecurityEvent("signin.ok", eventMeta(request, account.id)));
  const res = popup
    ? popupResult(request, { ok: true })
    : NextResponse.redirect(new URL(sessionNeedsTwoFactor(account, { twoFactor }) ? "/account" : next, publicOrigin(request)), 303);
  res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
  setSessionCookie(res, request, token);
  return res;
}
