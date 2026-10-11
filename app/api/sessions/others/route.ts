import { NextRequest, NextResponse } from "next/server";
import { adminSessionId } from "@/lib/api-auth";
import { revokeSessions } from "@/lib/sessions";

// Admin-only. "Sign out everywhere else" (#365): end every session but the
// caller's, so a session on a device the admin no longer trusts is gone
// without signing this one out.
export async function POST(request: NextRequest) {
  const current = await adminSessionId(request);
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ended = await revokeSessions(current);
  return NextResponse.json({ ok: true, ended });
}
