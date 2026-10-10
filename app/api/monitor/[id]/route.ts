import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { getServiceDetail } from "@/lib/monitor-detail";

// One integration's detail payload for its /admin/monitor/[id] page's live poll
// (#208). Admin-only twice over, exactly like /api/monitor: the proxy gates the
// prefix and the route re-checks the session — integration internals must stay
// unreachable even if the path allowlist drifts.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth.passwordHash))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await getServiceDetail(id, config.integrations);
  // No such integration, or not configured — nothing to show.
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Configured but maybe unreachable: `result` carries data-or-error, always
  // 200 so the detail page can render a calm offline state rather than a
  // fetch-failure the poller has to special-case.
  return NextResponse.json(result);
}
