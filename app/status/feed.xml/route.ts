import type { NextRequest } from "next/server";
import { readPublicConfig } from "@/lib/api-auth";
import { configMtime } from "@/lib/config";
import { monitoredApps } from "@/lib/schema";
import { getAppDetail, loadHistory } from "@/lib/status-history";
import { buildStatusFeed } from "@/lib/status-feed";

// The status page as an Atom feed (#295): each visible app's outages, with
// their incident notes, plus the status announcements. Same visibility as the
// page: a feed reader has no session, so it sees the public apps only, and
// with status checks off just the announcements.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { config, isAdmin } = await readPublicConfig(request);
  const { settings } = config;
  const outages = [];
  if (settings.statusChecks) {
    await loadHistory();
    for (const app of monitoredApps(config.apps)) {
      const minutes = app.interval ?? settings.statusInterval ?? 5;
      for (const outage of getAppDetail(app.id, "UTC", minutes).outages) {
        outages.push({ app: { id: app.id, name: app.name }, outage });
      }
    }
  }
  const body = buildStatusFeed({
    title: settings.title || "CtrlCenter",
    origin: request.nextUrl.origin,
    now: Date.now(),
    outages,
    announcements: settings.statusAnnouncements,
    announcementsUpdated: await configMtime(),
  });
  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      // An admin's feed lists private apps; never let a shared cache keep it.
      "cache-control": isAdmin ? "private, no-store" : "public, max-age=300",
    },
  });
}
