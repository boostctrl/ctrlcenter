import { matchesStatus, type AppStatus } from "./status";
import type { AppItem } from "./schema";

const TIMEOUT_MS = 5000;

// Ping one app's URL and decide up/down. HEAD avoids downloading bodies; some
// servers reject it, so fall back to GET. A reachable host is "up" unless the app
// defines an `expectStatus` spec (a comma list of codes/ranges) that the response
// code doesn't satisfy. A network error or timeout is always down.
//
// Shared by the live /api/status endpoint and the background history poller so
// both evaluate reachability identically.
export async function checkApp(
  app: Pick<AppItem, "url" | "expectStatus">
): Promise<AppStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    let res = await fetch(app.url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(app.url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
    }
    return {
      up: matchesStatus(res.status, app.expectStatus ?? ""),
      status: res.status,
      ms: Date.now() - start,
    };
  } catch {
    return { up: false, status: null, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}
