import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

// Public endpoint (not behind the admin proxy) the dashboard polls to render
// online/offline dots. It only ever pings the admin-configured app URLs, never
// arbitrary user input, so there's no SSRF surface beyond the links already
// shown on the page.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5000;

type AppStatus = { up: boolean; status: number | null; ms: number };

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
  if (!settings.statusChecks) return NextResponse.json([]);

  const results = await Promise.all(
    apps.map(async (app) => ({ id: app.id, ...(await check(app.url)) }))
  );
  return NextResponse.json(results);
}
