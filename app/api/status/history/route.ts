import { NextResponse, type NextRequest } from "next/server";
import { readConfig } from "@/lib/config";
import { loadHistory, getHistory } from "@/lib/status-history";
import { isValidTimeZone } from "@/lib/datetime";
import type { StatusHistory } from "@/lib/status";

// Public read of the recorded uptime history (per-app uptime % + daily timeline)
// the /status page charts. The data is produced by the background poller; here we
// just read the in-memory store (loading from disk if the poller hasn't yet). The
// optional `tz` query param buckets the daily timeline by the visitor's calendar
// day (validated; falls back to UTC).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { settings, apps } = await readConfig();
  if (!settings.statusChecks) {
    const empty: StatusHistory = { generatedAt: Date.now(), apps: [] };
    return NextResponse.json(empty);
  }
  await loadHistory();
  const tz = request.nextUrl.searchParams.get("tz") ?? "";
  const timeZone = isValidTimeZone(tz) ? tz : "UTC";
  // The poll cadence caps how long a 1h reading holds in the timeline.
  return NextResponse.json(
    getHistory(apps.map((a) => a.id), timeZone, settings.statusInterval)
  );
}
