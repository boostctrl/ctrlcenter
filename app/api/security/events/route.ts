import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { listSecurityEvents } from "@/lib/security-events";

// Admin-only (gated by the /api/security proxy prefix and re-checked here).
// The recent security events (#368) for Settings → Security, newest first.
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ events: await listSecurityEvents(50) });
}
