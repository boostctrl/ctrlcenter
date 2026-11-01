import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { clearSessionCookie } from "@/lib/auth";
import { getSession, revokeSession, sessionAccount } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// Admin-only. End one session (#365): its token stops verifying on the next
// request. Ending the caller's own session also clears their cookie, so the
// browser lands on the login page rather than a 401.
type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  const viewer = await viewerOf(request);
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const current = viewer.session.id;
  const { id } = await params;
  // A member may end only its own sessions (#423); a session that isn't
  // theirs answers like one that doesn't exist.
  const target = await getSession(id);
  if (!viewer.isAdmin && target && sessionAccount(target) !== viewer.account.id) {
    return NextResponse.json({ ok: true, ended: false, current: false });
  }
  const ended = await revokeSession(id);
  if (ended) await recordSecurityEvent("session.ended", eventMeta(request, viewer.account.id), id === current ? "this session" : "another session");
  const response = NextResponse.json({ ok: true, ended, current: id === current });
  if (id === current) clearSessionCookie(response);
  return response;
}
