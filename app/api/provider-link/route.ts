import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal, setProviderLink } from "@/lib/config";
import { oidcReady } from "@/lib/oidc";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// Connecting the asking account to the sign-in provider (#555), from its
// own page. POST checks the session was confirmed just now — connecting
// opens a way in — and answers where to send the browser; the provider's
// sign-in then finishes it (purpose=link). DELETE disconnects it, also
// behind a confirmation. Never with a token.
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer || viewer.token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!oidcReady(config.settings.signIn.oidc)) {
    return NextResponse.json({ error: "Signing in through a provider is turned off" }, { status: 409 });
  }
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  return NextResponse.json({ url: "/api/auth/oidc/start?purpose=link" });
}

export async function DELETE(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer || viewer.token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!viewer.account.provider) return new NextResponse(null, { status: 204 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  await setProviderLink(viewer.account.id, null);
  notifySecurityEvent(await recordSecurityEvent("provider.unlinked", eventMeta(request, viewer.account.id), viewer.account.id));
  return new NextResponse(null, { status: 204 });
}
