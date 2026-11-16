// A stand-in OpenID Connect provider for tests (#504): discovery, a signing
// key, the token endpoint (checking the code, the PKCE verifier and the
// client's secret) and UserInfo, answered through a stubbed fetch. A test
// "signs in" at it by taking the authorization URL the app redirected to
// and asking for a code for whoever it likes.
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

export const OP = "https://op.test";
export const CLIENT_ID = "ctrlcenter";
export const CLIENT_SECRET = "op-secret";

type Grant = {
  nonce: string;
  challenge: string;
  redirectUri: string;
  sub: string;
  idClaims: Record<string, unknown>;
  userinfo: Record<string, unknown>;
};

export async function mockProvider(opts: { userinfo?: boolean; endSession?: boolean } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, Grant>();
  const calls: string[] = [];

  const discovery = {
    issuer: OP,
    authorization_endpoint: `${OP}/authorize`,
    token_endpoint: `${OP}/token`,
    jwks_uri: `${OP}/jwks`,
    ...(opts.userinfo === false ? {} : { userinfo_endpoint: `${OP}/userinfo` }),
    ...(opts.endSession ? { end_session_endpoint: `${OP}/logout` } : {}),
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.pathname);
    if (url.origin !== OP) throw new Error(`unexpected fetch ${url}`);
    if (url.pathname === "/.well-known/openid-configuration") return json(discovery);
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/token") {
      const body = new URLSearchParams(String(init?.body ?? (input instanceof Request ? await input.text() : "")));
      const grant = grants.get(body.get("code") ?? "");
      if (!grant) return json({ error: "invalid_grant" }, 400);
      grants.delete(body.get("code") ?? "");
      const verifier = body.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (challenge !== grant.challenge) return json({ error: "invalid_grant", error_description: "PKCE" }, 400);
      if (body.get("redirect_uri") !== grant.redirectUri) return json({ error: "invalid_grant", error_description: "redirect_uri" }, 400);
      if (body.get("client_id") !== CLIENT_ID || body.get("client_secret") !== CLIENT_SECRET) {
        return json({ error: "invalid_client" }, 401);
      }
      const access = randomBytes(16).toString("hex");
      tokens.set(access, grant);
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ nonce: grant.nonce, auth_time: now, ...grant.idClaims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(OP)
        .setAudience(CLIENT_ID)
        .setSubject(grant.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      return json({ access_token: access, token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    if (url.pathname === "/userinfo") {
      const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization") ?? "";
      const grant = tokens.get(auth.replace(/^Bearer /i, ""));
      if (!grant) return json({ error: "invalid_token" }, 401);
      return json({ sub: grant.sub, ...grant.userinfo });
    }
    return json({ error: "not_found" }, 404);
  }

  // The provider's sign-in: a code for this authorization request, standing
  // for `who`. The ID token carries `idClaims` (an `amr`, say); UserInfo
  // carries `userinfo` (Nextcloud puts the name and the groups there).
  function signIn(
    authorizeUrl: string,
    who: { sub?: string; idClaims?: Record<string, unknown>; userinfo?: Record<string, unknown> }
  ): { code: string; state: string } {
    const url = new URL(authorizeUrl);
    if (url.origin + url.pathname !== `${OP}/authorize`) throw new Error(`not an authorization URL: ${authorizeUrl}`);
    const code = randomBytes(8).toString("hex");
    grants.set(code, {
      nonce: url.searchParams.get("nonce") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
      redirectUri: url.searchParams.get("redirect_uri") ?? "",
      sub: who.sub ?? "user-1",
      idClaims: who.idClaims ?? {},
      userinfo: who.userinfo ?? {},
    });
    return { code, state: url.searchParams.get("state") ?? "" };
  }

  return { fetch: fetchImpl, signIn, calls };
}
