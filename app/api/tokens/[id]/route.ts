import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { findToken, revokeToken } from "@/lib/api-tokens";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

type Params = { params: Promise<{ id: string }> };

// Revoke a token (#538): an account its own, an admin anyone's. Recorded.
export async function DELETE(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const token = await findToken(id);
  if (!token || (token.account !== viewer.account.id && !viewer.isAdmin)) {
    return NextResponse.json({ error: "No such token" }, { status: 404 });
  }
  await revokeToken(id);
  await recordSecurityEvent("token.revoked", eventMeta(request, viewer.account.id), `${token.name} (${token.account})`);
  return new NextResponse(null, { status: 204 });
}
