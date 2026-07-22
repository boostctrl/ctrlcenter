import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { getMonitorSnapshot } from "@/lib/monitor";

// The private Monitor dashboard's data plane (#189/#207): one JSON snapshot
// of every configured integration, served from the shared
// stale-while-revalidate cache (lib/monitor.ts). Admin-only twice over: the
// proxy gates the /api/monitor prefix, and the route re-checks the session
// itself — infrastructure internals must stay unreachable even if the
// path allowlist ever drifts.
export async function GET(request: NextRequest) {
  // One config read for both the auth check and the integration settings:
  // every open Monitor tab polls this route, so pass the password hash into
  // isAdminRequest instead of letting it read and parse config.yaml a second
  // time (the fast path the polled status routes already take).
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth.passwordHash))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    await getMonitorSnapshot(config.settings.integrations)
  );
}
