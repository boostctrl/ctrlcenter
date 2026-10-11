import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, sessionTokenFrom, verifySessionId } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { revokeSession } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

export async function POST(request: NextRequest) {
  // Same-origin only, so a cross-site page can't sign the admin out.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // End the session itself, not just the cookie: a copy of the token taken
  // before logout must not keep working (#365).
  const token = sessionTokenFrom(request.cookies);
  if (token) {
    const { auth } = await readConfigInternal();
    const id = await verifySessionId(token, auth.passwordHash);
    if (id) {
      await revokeSession(id);
      await recordSecurityEvent("signout", eventMeta(request));
    }
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
