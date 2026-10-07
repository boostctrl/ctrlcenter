import { NextResponse, type NextRequest } from "next/server";
import { readConfigInternal } from "@/lib/config";
import { isAdminRequest, visibleItems } from "@/lib/api-auth";
import { checkApp, CHECK_CONCURRENCY } from "@/lib/status-check";
import { mapLimit } from "@/lib/concurrency";
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
// The check round in progress, if any. Every caller that finds the cache
// stale while one is running shares it — several dashboard tabs polling at
// once used to each fan out to every app.
let inFlight: Promise<StatusResult[]> | null = null;

// The response now varies with the caller's session (private apps are filtered
// out for guests), and Next sends no Cache-Control of its own here — a shared
// cache in front of the app could legally store an admin's body and serve it
// to anonymous visitors. Forbid that explicitly on every response.
const NO_SHARED_CACHE = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  const { settings, apps, auth } = await readConfigInternal();
  if (!settings.statusChecks) {
    const empty: StatusResponse = { checkedAt: Date.now(), results: [] };
    return NextResponse.json(empty, { headers: NO_SHARED_CACHE });
  }

  // The cache always holds every app's result; visibility is applied per
  // response, so a window filled by an anonymous caller still serves a later
  // admin request in full.
  const ids = new Set(
    visibleItems(apps, await isAdminRequest(request, auth.passwordHash)).map(
      (a) => a.id
    )
  );
  const toCaller = (results: StatusResult[]) =>
    results.filter((r) => ids.has(r.id));

  if (cache && Date.now() - cache.at < CACHE_MS) {
    const cached: StatusResponse = {
      checkedAt: cache.at,
      results: toCaller(cache.data),
    };
    return NextResponse.json(cached, { headers: NO_SHARED_CACHE });
  }

  inFlight ??= mapLimit(apps, CHECK_CONCURRENCY, async (app) => ({
    id: app.id,
    ...(await checkApp(app)),
  }))
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inFlight = null;
    });
  const results = await inFlight;
  const body: StatusResponse = {
    checkedAt: cache?.at ?? Date.now(),
    results: toCaller(results),
  };
  return NextResponse.json(body, { headers: NO_SHARED_CACHE });
}
