import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { NotFoundError, readConfigInternal, setProviderLink } from "@/lib/config";
import { findAccount } from "@/lib/accounts";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

type Params = { params: Promise<{ id: string }> };

// An admin disconnects an account from the sign-in provider (#555): a
// provider account that isn't that person's any more, say. Behind a
// confirmation; recorded and announced.
export async function DELETE(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!findAccount(config.auth, id)) return NextResponse.json({ error: "No such account" }, { status: 404 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  try {
    await setProviderLink(id, null);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "No such account" }, { status: 404 });
    throw e;
  }
  notifySecurityEvent(await recordSecurityEvent("provider.unlinked", eventMeta(request, viewer.account.id), id));
  return new NextResponse(null, { status: 204 });
}
