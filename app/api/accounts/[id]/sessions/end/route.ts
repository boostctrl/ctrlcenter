import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { findAccount } from "@/lib/accounts";
import { revokeSessions } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

type Params = { params: Promise<{ id: string }> };

// Sign one account out everywhere (#423), from the Users tab.
export async function POST(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!findAccount(config.auth, id)) return NextResponse.json({ error: "No such account" }, { status: 404 });
  // The admin's own current session stays, so this can't sign them out.
  const ended = await revokeSessions(id === viewer.account.id ? viewer.session.id : undefined, id);
  if (ended > 0) await recordSecurityEvent("sessions.ended", eventMeta(request, viewer.account.id), `${ended} session${ended === 1 ? "" : "s"} of ${id}`);
  return NextResponse.json({ ok: true, ended });
}
