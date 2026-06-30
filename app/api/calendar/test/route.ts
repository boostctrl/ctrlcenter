import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { probeCalendar } from "@/lib/calendar";

// Admin-only: fetch the given calendar URL fresh and report whether it's a
// reachable, parsable feed and how many upcoming events it has. Gated here
// (not via the proxy, which only covers /admin, /api/settings, /api/config) so
// the public sibling routes stay public. Takes the URL/credentials in the body
// so the admin can test the values currently in the form before saving.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  const username = typeof body?.username === "string" ? body.username : undefined;
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!url.trim()) {
    return NextResponse.json({ ok: false, count: 0, error: "No URL set" });
  }
  const result = await probeCalendar(url, { username, password });
  return NextResponse.json(result);
}
