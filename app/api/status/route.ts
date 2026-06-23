import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { checkApp } from "@/lib/status-check";
import type { StatusResult, StatusResponse } from "@/lib/status";

// Public endpoint (not behind the admin proxy) the dashboard polls to render
// online/offline dots. It only ever pings the admin-configured app URLs, never
// arbitrary user input, so there's no SSRF surface beyond the links already
// shown on the page.
export const dynamic = "force-dynamic";

// This endpoint is public and fans out to every app URL, so cache the result
// briefly. Repeated/abusive calls within the window are served from cache
// instead of re-pinging, capping the outbound amplification.
const CACHE_MS = 30_000;

let cache: { at: number; data: StatusResult[] } | null = null;

export async function GET() {
  const { settings, apps } = await readConfig();
  if (!settings.statusChecks) {
    const empty: StatusResponse = { checkedAt: Date.now(), results: [] };
    return NextResponse.json(empty);
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    const cached: StatusResponse = { checkedAt: cache.at, results: cache.data };
    return NextResponse.json(cached);
  }

  const results: StatusResult[] = await Promise.all(
    apps.map(async (app) => ({ id: app.id, ...(await checkApp(app)) }))
  );
  cache = { at: Date.now(), data: results };
  const body: StatusResponse = { checkedAt: cache.at, results };
  return NextResponse.json(body);
}
