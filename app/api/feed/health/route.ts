import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { getFeedHealth } from "@/lib/feed";

// Admin-only: the last recorded fetch outcome per feed URL ("OK · 12 entries"
// / "HTTP 500"), keyed by URL. Read-only diagnostics for Settings → Widgets →
// RSS feed — it reports what the home page's own fetches saw, so it fills in
// as those happen; the Test feed button stays the fresh probe.
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ health: getFeedHealth() });
}
