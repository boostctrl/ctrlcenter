import { NextRequest, NextResponse } from "next/server";
import { adminSessionId } from "@/lib/api-auth";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { revokeSession } from "@/lib/sessions";

// Admin-only. End one session (#365): its token stops verifying on the next
// request. Ending the caller's own session also clears their cookie, so the
// browser lands on the login page rather than a 401.
type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  const current = await adminSessionId(request);
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ended = await revokeSession(id);
  const response = NextResponse.json({ ok: true, ended, current: id === current });
  if (id === current) response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
