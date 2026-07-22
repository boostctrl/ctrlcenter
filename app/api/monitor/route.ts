import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { getSettings } from "@/lib/config";
import { getMonitorSnapshot } from "@/lib/monitor";

// The private Monitor dashboard's data plane (#189/#207): one JSON snapshot
// of every configured integration, served from the shared
// stale-while-revalidate cache (lib/monitor.ts). Admin-only twice over: the
// proxy gates the /api/monitor prefix, and the route re-checks the session
// itself — infrastructure internals must stay unreachable even if the
// path allowlist ever drifts.
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getSettings();
  return NextResponse.json(await getMonitorSnapshot(settings.integrations));
}
