// Signing in through an OpenID Connect provider (#504): the authorization
// code flow with PKCE, a state and a nonce, through openid-client. The
// provider is found by discovery from its issuer; the identity comes back
// as the ID token's claims (checked: issuer, audience, nonce, expiry) with
// the UserInfo endpoint's on top, which is where Nextcloud's OIDC app puts
// the sign-in name and the groups in this flow.
//
// What leaves for the provider and has to survive the round trip — the
// state, nonce and PKCE verifier, where to go after, and what the sign-in
// is for — rides in a signed cookie scoped to /api/auth/oidc for ten
// minutes, so nothing is kept on the server between the two requests.
import { createHash } from "crypto";
import * as client from "openid-client";
import type { NextRequest } from "next/server";
import { OIDC_DEFAULT_SCOPES, type OidcConfig } from "./schema/sign-in";
import { USER_ID_PATTERN } from "./schema/auth";
import { globalSingleton } from "./singleton";

export const OIDC_CALLBACK_PATH = "/api/auth/oidc/callback";
export const OIDC_FLOW_COOKIE = "ctrlcenter_oidc";
export const OIDC_FLOW_TTL = 600;

// What a sign-in is for: a new session, or a step-up confirmation of the
// session that started it (#366). `popup`: it runs in a window the page
// opened, and answers that page instead of navigating.
export type OidcPurpose = "signin" | "reauth";
export type OidcFlow = {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  purpose: OidcPurpose;
  popup: boolean;
};

// The client secret: CTRLCENTER_OIDC_CLIENT_SECRET wins over the stored one.
export function oidcClientSecret(o: OidcConfig): string {
  return process.env.CTRLCENTER_OIDC_CLIENT_SECRET?.trim() || o.clientSecret;
}

// Whether the provider is set up enough to offer its button.
export function oidcReady(o: OidcConfig): boolean {
  return o.enabled && o.issuer.trim() !== "" && o.clientId.trim() !== "";
}

// "Sign in with Nextcloud"; a generic name until one is set.
export function oidcButtonLabel(o: OidcConfig): string {
  return `Sign in with ${o.label.trim() || "single sign-on"}`;
}

// The address this app is reached at, as the browser sees it: behind a
// reverse proxy the request arrives as plain HTTP for the proxy's own
// host, and the forwarded headers say what the browser used. The provider
// only accepts the redirect address registered with it, so a forged header
// can't send a code anywhere else.
export function publicOrigin(request: NextRequest): string {
  const first = (h: string | null) => h?.split(",")[0]?.trim() || "";
  const proto = first(request.headers.get("x-forwarded-proto")) || request.nextUrl.protocol.replace(/:$/, "");
  const host = first(request.headers.get("x-forwarded-host")) || request.headers.get("host") || request.nextUrl.host;
  return `${proto}://${host}`;
}
export function oidcRedirectUri(request: NextRequest): string {
  return `${publicOrigin(request)}${OIDC_CALLBACK_PATH}`;
}

// The discovered provider, kept for an hour per issuer, client and secret.
type Cached = { key: string; at: number; config: client.Configuration };
const CACHE_MS = 60 * 60 * 1000;
const cache = globalSingleton("__ctrlcenterOidc", () => ({ entry: null as Cached | null }));
export function forgetOidcDiscovery(): void {
  cache.entry = null;
}

async function discover(o: OidcConfig, url: URL): Promise<client.Configuration> {
  const secret = oidcClientSecret(o);
  return client.discovery(
    url,
    o.clientId.trim(),
    secret || undefined,
    // A public client (no secret) proves itself with PKCE alone.
    secret ? undefined : client.None(),
    { timeout: 10, execute: url.protocol === "http:" ? [client.allowInsecureRequests] : [] }
  );
}

// The provider's configuration. The issuer's own discovery document first;
// failing that, Nextcloud's, which its app serves under index.php when the
// web server doesn't route /.well-known to it. An address that is itself a
// discovery document is used as given.
export async function oidcConfiguration(o: OidcConfig, now = Date.now()): Promise<client.Configuration> {
  const issuer = o.issuer.trim();
  const key = JSON.stringify([issuer, o.clientId.trim(), createHash("sha256").update(oidcClientSecret(o)).digest("hex")]);
  const hit = cache.entry;
  if (hit && hit.key === key && now - hit.at < CACHE_MS) return hit.config;
  let config: client.Configuration;
  try {
    config = await discover(o, new URL(issuer));
  } catch (e) {
    if (issuer.includes("/.well-known/")) throw e;
    try {
      config = await discover(o, new URL(`${issuer.replace(/\/+$/, "")}/index.php/.well-known/openid-configuration`));
    } catch {
      throw e;
    }
  }
  cache.entry = { key, at: now, config };
  return config;
}

// Where to send the browser to sign in, and the flow to keep for the way
// back. A step-up asks the provider for a fresh sign-in, not a remembered
// one.
export async function startOidc(
  o: OidcConfig,
  request: NextRequest,
  flow: Pick<OidcFlow, "next" | "purpose" | "popup">
): Promise<{ url: URL; flow: OidcFlow }> {
  const config = await oidcConfiguration(o);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidcRedirectUri(request),
    scope: o.scopes.trim() || OIDC_DEFAULT_SCOPES,
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    ...(flow.purpose === "reauth" ? { prompt: "login", max_age: "0" } : {}),
  });
  return { url, flow: { ...flow, state, nonce, verifier } };
}

// Who signed in: the account name the configured claim gives (lowercased,
// and only when it could be a sign-in name), their display name, the
// groups claim's names, and whether the provider says a second factor was
// used (`amr`) — or is trusted to have required one.
export type OidcIdentity = {
  username: string | null;
  name: string;
  groups: string[];
  twoFactor: boolean;
};

// The `amr` values that mean more than a password (RFC 8176).
const SECOND_FACTORS = new Set(["mfa", "otp", "hwk", "sms", "fpt", "face", "iris", "retina", "vbm", "pop"]);

function namesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return [...new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

export function identityOf(o: OidcConfig, claims: Record<string, unknown>, amr: unknown): OidcIdentity {
  const raw = claims[o.usernameClaim.trim() || "preferred_username"];
  const username = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const name = typeof claims.name === "string" ? claims.name.trim().slice(0, 80) : "";
  return {
    username: USER_ID_PATTERN.test(username) ? username : null,
    name,
    groups: o.groupsClaim.trim() ? namesOf(claims[o.groupsClaim.trim()]) : [],
    twoFactor: o.enforcesTwoFactor || (Array.isArray(amr) && amr.some((a) => typeof a === "string" && SECOND_FACTORS.has(a))),
  };
}

// The way back: the code exchanged (with the verifier), the ID token
// checked against the state and nonce kept for this flow, and the
// provider's UserInfo read for the claims the ID token leaves out. A
// step-up also needs the provider to have signed the person in just now.
export async function finishOidc(o: OidcConfig, request: NextRequest, flow: OidcFlow): Promise<OidcIdentity> {
  const config = await oidcConfiguration(o);
  // The callback as the browser reached it: the token request repeats the
  // redirect address exactly as the authorization request sent it.
  const current = new URL(oidcRedirectUri(request));
  current.search = request.nextUrl.search;
  const tokens = await client.authorizationCodeGrant(config, current, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
    ...(flow.purpose === "reauth" ? { maxAge: 300 } : {}),
  });
  const idClaims = (tokens.claims() ?? {}) as Record<string, unknown>;
  let userinfo: Record<string, unknown> = {};
  if (config.serverMetadata().userinfo_endpoint && typeof idClaims.sub === "string") {
    userinfo = (await client.fetchUserInfo(config, tokens.access_token, idClaims.sub)) as Record<string, unknown>;
  }
  return identityOf(o, { ...idClaims, ...userinfo, sub: idClaims.sub }, idClaims.amr);
}

// Where to send the browser to sign out of the provider too, back to this
// app afterwards; null when the provider has no end-session endpoint.
export async function oidcEndSessionUrl(o: OidcConfig, request: NextRequest): Promise<string | null> {
  const config = await oidcConfiguration(o);
  if (!config.serverMetadata().end_session_endpoint) return null;
  return client
    .buildEndSessionUrl(config, { client_id: o.clientId.trim(), post_logout_redirect_uri: `${publicOrigin(request)}/` })
    .toString();
}
