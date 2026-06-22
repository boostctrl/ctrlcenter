import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import type { AppStatus, StatusResult, StatusResponse } from "@/lib/status";

// Public endpoint (not behind the admin proxy) the dashboard polls to render
// online/offline dots. It only ever pings the admin-configured app URLs, never
// arbitrary user input, so there's no SSRF surface beyond the links already
// shown on the page.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5000;

// This endpoint is public and fans out to every app URL, so cache the result
// briefly. Repeated/abusive calls within the window are served from cache
// instead of re-pinging, capping the outbound amplification.
const CACHE_MS = 30_000;

let cache: { at: number; data: StatusResult[] } | null = null;

async function check(url: string): Promise<AppStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    // A reachable host is "up" even if it answers 401/403/5xx — we only treat a
    // network error or timeout as down. HEAD avoids downloading bodies; some
    // servers reject it, so fall back to GET.
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
    }
    return { up: true, status: res.status, ms: Date.now() - start };
  } catch {
    return { up: false, status: null, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

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
    apps.map(async (app) => ({ id: app.id, ...(await check(app.url)) }))
  );
  cache = { at: Date.now(), data: results };
  const body: StatusResponse = { checkedAt: cache.at, results };
  return NextResponse.json(body);
}
