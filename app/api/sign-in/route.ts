import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal, setSignIn } from "@/lib/config";
import { forgetOidcDiscovery, oidcConfiguration, oidcRedirectUri } from "@/lib/oidc";
import { requireRecentAuth } from "@/lib/reauth";
import { SECRET_PLACEHOLDER, signInSchema, signInUpdateSchema } from "@/lib/schema";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { errorReason } from "@/lib/log";

// Signing in through a provider (#504), for Settings → Users: the settings
// with the client secret as a placeholder, the redirect address to register
// with the provider, and whether the secret comes from the environment.
// `?check=1` also tries the provider's discovery with what is saved.
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
  return NextResponse.json({
    oidc: { ...o, clientSecret: o.clientSecret ? SECRET_PLACEHOLDER : "" },
    redirectUri: oidcRedirectUri(request),
    secretFromEnv: Boolean(process.env.CTRLCENTER_OIDC_CLIENT_SECRET?.trim()),
    ...(check ? { check } : {}),
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
  const stored = config.settings.signIn.oidc;
  const oidc = {
    ...parsed.data.oidc,
    clientSecret: parsed.data.oidc.clientSecret === SECRET_PLACEHOLDER ? stored.clientSecret : parsed.data.oidc.clientSecret,
  };
  await setSignIn(signInSchema.parse({ oidc }));
  forgetOidcDiscovery();
  notifySecurityEvent(
    await recordSecurityEvent("signin.provider", eventMeta(request, viewer.account.id), oidc.enabled ? "on" : "off")
  );
  return NextResponse.json({ ok: true });
}
