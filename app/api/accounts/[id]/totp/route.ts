import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { disableTotp, NotFoundError, readConfigInternal } from "@/lib/config";
import { findAccount } from "@/lib/accounts";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

type Params = { params: Promise<{ id: string }> };

// An admin turns another account's second factor off (#423): the way back
// in for someone who lost their authenticator and recovery codes. Step-up:
// it weakens that account. One's own goes through POST /api/2fa/disable.
export async function DELETE(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (id === viewer.account.id) {
    return NextResponse.json({ error: "Turn your own second factor off in Settings → Security" }, { status: 400 });
  }
  const account = findAccount(config.auth, id);
  if (!account) return NextResponse.json({ error: "No such account" }, { status: 404 });
  if (!account.totp.enabled) return NextResponse.json({ ok: true });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  try {
    await disableTotp(id);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "No such account" }, { status: 404 });
    throw e;
  }
  notifySecurityEvent(await recordSecurityEvent("totp.disabled", eventMeta(request, viewer.account.id), `for ${id}`));
  return NextResponse.json({ ok: true });
}
