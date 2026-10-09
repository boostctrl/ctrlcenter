import { NextResponse, type NextRequest } from "next/server";
import { readConfigInternal } from "@/lib/config";
import { isAdminRequest, visibleItems } from "@/lib/api-auth";
import { checkApp, checkSignature, CHECK_CONCURRENCY } from "@/lib/status-check";
import { mapLimit } from "@/lib/concurrency";
import { latestRound, type StatusRound } from "@/lib/status-latest";
import { swrCache } from "@/lib/swr-cache";
import type { StatusResponse } from "@/lib/status";

// Public endpoint (not behind the admin proxy) the dashboard polls to render
// online/offline dots. It only ever pings the admin-configured app URLs, never
// arbitrary user input, so there's no SSRF surface beyond the links already
// shown on the page.
export const dynamic = "force-dynamic";

// The background poller (lib/status-poller.ts) already checks every app on the
// configured interval, so this endpoint serves its latest round instead of
// probing on a second schedule (#278). It only probes on demand for what the
// round can't answer: apps added since it ran, or everything when there's no
// current round (just after boot, or a poller that has stopped ticking).
//
// Those probes are cached briefly — the endpoint is public, so repeated or
// abusive calls within the window are served from cache instead of
// re-pinging, capping the outbound amplification.
const PROBE_TTL_MS = 30_000;
const probes = swrCache<StatusRound>("status-probe", PROBE_TTL_MS);
// A round older than two intervals (plus a minute for a slow round) means the
// poller isn't keeping up, so its readings no longer count as current.
const POLL_SLACK_MS = 60_000;

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

  // Visibility is applied per response.
  const ids = new Set(
    visibleItems(apps, await isAdminRequest(request, auth.passwordHash)).map(
      (a) => a.id
    )
  );
  const intervalMs = (settings.statusInterval ?? 5) * 60_000;
  const round = latestRound();
  const current =
    round && Date.now() - round.at <= 2 * intervalMs + POLL_SLACK_MS ? round : null;
  // Every app's result, visibility aside: a probe filled by an anonymous
  // caller still serves a later admin request in full.
  const byId = new Map((current?.results ?? []).map((r) => [r.id, r]));
  // Apps the round has no result for, or checked against a since-edited URL.
  const missing = apps.filter(
    (a) => !byId.has(a.id) || current?.signatures[a.id] !== checkSignature(a)
  );
  let checkedAt = current?.at ?? Date.now();
  if (missing.length > 0) {
    // Keyed by what's probed, so concurrent callers share one round of checks
    // and an edit gets a fresh probe.
    const key = missing.map((a) => `${a.id}=${checkSignature(a)}`).join("\n");
    const probe = await probes.get(key, async () => ({
      at: Date.now(),
      results: await mapLimit(missing, CHECK_CONCURRENCY, async (app) => ({
        id: app.id,
        ...(await checkApp(app)),
      })),
      signatures: Object.fromEntries(missing.map((a) => [a.id, checkSignature(a)])),
    }));
    for (const r of probe?.results ?? []) byId.set(r.id, r);
    if (probe) checkedAt = current ? Math.min(current.at, probe.at) : probe.at;
  }

  const body: StatusResponse = {
    checkedAt,
    results: apps.flatMap((a) => {
      const r = byId.get(a.id);
      return r && ids.has(a.id) ? [r] : [];
    }),
  };
  return NextResponse.json(body, { headers: NO_SHARED_CACHE });
}
