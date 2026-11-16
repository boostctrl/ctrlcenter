import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal, removePasskey } from "@/lib/config";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

type Params = { params: Promise<{ id: string }> };

// Remove one of the asking account's passkeys (#537), after a recent
// confirmation; recorded and announced.
export async function DELETE(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer || viewer.token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const passkey = viewer.account.passkeys.find((p) => p.id === id);
  if (!passkey) return NextResponse.json({ error: "No such passkey" }, { status: 404 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  await removePasskey(viewer.account.id, id);
  notifySecurityEvent(await recordSecurityEvent("passkey.removed", eventMeta(request, viewer.account.id), passkey.name));
  return new NextResponse(null, { status: 204 });
}
