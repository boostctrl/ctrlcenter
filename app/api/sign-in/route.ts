import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal, setSignIn } from "@/lib/config";
import { forgetOidcDiscovery, oidcConfiguration, oidcRedirectUri } from "@/lib/oidc";
import { requireRecentAuth } from "@/lib/reauth";
import { SECRET_PLACEHOLDER, forwardAuthSchema, oidcSchema, signInUpdateSchema } from "@/lib/schema";
import { badProxyEntries, forwardIdentity, fromProxy } from "@/lib/forward-auth";
import { peerAddress, productionEntry } from "@/lib/rate-limit";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { errorReason } from "@/lib/log";

// Signing in through a provider or the reverse proxy (#504), for Settings →
// Users: the settings with the client secret as a placeholder, the redirect
// address to register with the provider, whether the secret comes from the
// environment; and, to help set forward-auth up, the address this request
// came from, whether that is one of the proxy's, and who the proxy says
// this is. `?check=1` also tries the provider's discovery with what is
// saved.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const o = config.settings.signIn.oidc;
  let check: { ok: boolean; error?: string } | undefined;
  if (request.nextUrl.searchParams.get("check") === "1") {
    try {
      forgetOidcDiscovery();
      await oidcConfiguration(o);
      check = { ok: true };
    } catch (e) {
      check = { ok: false, error: errorReason(e) };
    }
  }
  const fa = config.settings.signIn.forwardAuth;
  const peer = peerAddress(request.headers);
  return NextResponse.json({
    oidc: { ...o, clientSecret: o.clientSecret ? SECRET_PLACEHOLDER : "" },
    redirectUri: oidcRedirectUri(request),
    secretFromEnv: Boolean(process.env.CTRLCENTER_OIDC_CLIENT_SECRET?.trim()),
    ...(check ? { check } : {}),
    forwardAuth: fa,
    proxy: {
      // Null outside the Docker image, where the address can't be told.
      peer,
      productionEntry: productionEntry(),
      fromProxy: fromProxy(peer, fa.proxies),
      seen: forwardIdentity(request.headers, { ...fa, enabled: true })?.raw ?? null,
    },
  });
}

// Save them. It opens a way in, so it takes a recent confirmation and is
// recorded; a secret left as the placeholder keeps the stored one.
export async function PUT(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const parsed = signInUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { oidc, forwardAuth } = parsed.data;
  if (forwardAuth) {
    const bad = badProxyEntries(forwardAuth.proxies);
    if (bad.length) {
      return NextResponse.json({ error: `Not an address or a range: ${bad.join(", ")}` }, { status: 400 });
    }
  }
  const stored = config.settings.signIn.oidc;
  await setSignIn({
    ...(oidc
      ? {
          oidc: oidcSchema.parse({
            ...oidc,
            clientSecret: oidc.clientSecret === SECRET_PLACEHOLDER ? stored.clientSecret : oidc.clientSecret,
          }),
        }
      : {}),
    ...(forwardAuth
      ? { forwardAuth: forwardAuthSchema.parse({ ...forwardAuth, proxies: forwardAuth.proxies.filter((p) => p !== "") }) }
      : {}),
  });
  if (oidc) forgetOidcDiscovery();
  const detail = [oidc && `provider ${oidc.enabled ? "on" : "off"}`, forwardAuth && `proxy headers ${forwardAuth.enabled ? "on" : "off"}`]
    .filter(Boolean)
    .join(", ");
  notifySecurityEvent(await recordSecurityEvent("signin.provider", eventMeta(request, viewer.account.id), detail));
  return NextResponse.json({ ok: true });
}
