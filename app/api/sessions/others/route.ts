import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { revokeSessions } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// Admin-only. "Sign out everywhere else" (#365): end every session but the
// caller's, so a session on a device the admin no longer trusts is gone
// without signing this one out.
export async function POST(request: NextRequest) {
  const viewer = await viewerOf(request);
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Everyone else's for an admin; a member's own others only (#423).
  const current = viewer.session.id;
  const ended = await revokeSessions(current, viewer.isAdmin ? undefined : viewer.account.id);
  if (ended > 0) await recordSecurityEvent("sessions.ended", eventMeta(request, viewer.account.id), `${ended} other session${ended === 1 ? "" : "s"}`);
  return NextResponse.json({ ok: true, ended });
}
