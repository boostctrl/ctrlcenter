import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { probeFeed } from "@/lib/feed";

// Admin-only: fetch the given feed URL fresh and report whether it's a
// readable RSS/Atom feed and how many entries it has. Gated here (not via the
// proxy) like /api/calendar/test. Takes the URL in the body so the admin can
// test the value currently in the form before saving.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!url.trim()) {
    return NextResponse.json({ ok: false, count: 0, error: "No URL set" });
  }
  const result = await probeFeed(url);
  return NextResponse.json(result);
}
