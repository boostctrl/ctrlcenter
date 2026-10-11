import { NextRequest, NextResponse } from "next/server";
import { adminSessionId } from "@/lib/api-auth";
import { revokeSessions } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// Admin-only. "Sign out everywhere else" (#365): end every session but the
// caller's, so a session on a device the admin no longer trusts is gone
// without signing this one out.
export async function POST(request: NextRequest) {
  const current = await adminSessionId(request);
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ended = await revokeSessions(current);
  if (ended > 0) await recordSecurityEvent("sessions.ended", eventMeta(request), `${ended} other session${ended === 1 ? "" : "s"}`);
  return NextResponse.json({ ok: true, ended });
}
