import { NextResponse, type NextRequest } from "next/server";
import { readConfigInternal } from "@/lib/config";
import { isAdminRequest, visibleItems } from "@/lib/api-auth";
import { loadHistory, getAppDetail } from "@/lib/status-history";
import { isValidTimeZone } from "@/lib/datetime";
import type { StatusDetailResponse } from "@/lib/status";

// Public read of one app's recorded history at the detail page's resolution
// (#150): DETAIL_BARS-long series per range plus the derived outage log. The
// caller's visibility decides existence — an id that is unknown, private to a
// guest, or has checks disabled 404s identically, so this route can't be used
// to probe which private apps exist (same rule as the /status page itself).
export const dynamic = "force-dynamic";

// Session-dependent since private apps 404 per caller — keep shared caches
// from serving an admin's body to guests (same as the list endpoint).
const NO_SHARED_CACHE = { "cache-control": "private, no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { settings, apps, auth } = await readConfigInternal();
  const visible = settings.statusChecks
    ? visibleItems(apps, await isAdminRequest(request, auth.passwordHash))
    : [];
  if (!visible.some((a) => a.id === id)) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: NO_SHARED_CACHE }
    );
  }
  await loadHistory();
  const tz = request.nextUrl.searchParams.get("tz") ?? "";
  const timeZone = isValidTimeZone(tz) ? tz : "UTC";
  const body: StatusDetailResponse = {
    generatedAt: Date.now(),
    app: getAppDetail(id, timeZone, settings.statusInterval),
  };
  return NextResponse.json(body, { headers: NO_SHARED_CACHE });
}
