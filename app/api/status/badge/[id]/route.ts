import { NextResponse, type NextRequest } from "next/server";
import { readPublicConfig } from "@/lib/api-auth";
import { monitoredApps } from "@/lib/schema";
import { latestCheck } from "@/lib/status-latest";
import { checkSignature } from "@/lib/status-check";
import { getHistory, loadHistory } from "@/lib/status-history";
import { maintenanceApps } from "@/lib/status-announcements";
import { STATUS_RANGES, type StatusRangeKey } from "@/lib/status";
import {
  BADGE_COLORS,
  formatUptime,
  renderBadge,
  responseColor,
  uptimeColor,
} from "@/lib/status-badge";

// Public SVG badge for one app (#295): /api/status/badge/<id>.svg, with
// ?type=status (default), uptime or response, and for the last two ?range=
// 1h/24h/30d/90d (h1/d1/d30/d90, default 30d). ?label= overrides the left
// text. Visibility follows the status page: an id that is unknown, private to
// a guest, unmonitored, or with checks off 404s identically. Served from the
// poller's latest check and the recorded history, never by probing, so a
// badge on a busy page can't make the server hammer the app.
export const dynamic = "force-dynamic";

const POLL_SLACK_MS = 60_000;
const RANGE_LABEL: Record<StatusRangeKey, string> = Object.fromEntries(
  STATUS_RANGES.map((r) => [r.key, r.label])
) as Record<StatusRangeKey, string>;

function svg(body: string, isPrivate: boolean): NextResponse {
  return new NextResponse(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // A minute keeps image proxies (GitHub's camo) from re-fetching on
      // every view. A private app's badge is per-session, never shared.
      "cache-control": isPrivate ? "private, max-age=60" : "public, max-age=60",
      // An SVG opened directly is a document; let it run nothing.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id.replace(/\.svg$/i, "");
  const { config } = await readPublicConfig(request);
  const { settings } = config;
  const app = settings.statusChecks
    ? monitoredApps(config.apps).find((a) => a.id === id)
    : undefined;
  if (!app) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "private, no-store" } }
    );
  }

  const q = request.nextUrl.searchParams;
  const type = q.get("type") ?? "status";
  const rangeParam = q.get("range") ?? "d30";
  const range: StatusRangeKey =
    STATUS_RANGES.find((r) => r.key === rangeParam || r.label === rangeParam)?.key ?? "d30";
  const custom = q.get("label")?.trim().slice(0, 40);
  const minutes = app.interval ?? settings.statusInterval ?? 5;

  if (type === "uptime" || type === "response") {
    await loadHistory();
    const h = getHistory([app.id], "UTC", minutes).apps[0];
    if (type === "uptime") {
      const pct = h.uptime[range];
      return svg(
        renderBadge(
          custom || `uptime ${RANGE_LABEL[range]}`,
          pct == null ? "no data" : formatUptime(pct),
          pct == null ? BADGE_COLORS.unknown : uptimeColor(pct)
        ),
        app.private
      );
    }
    const avg = h.latency[range]?.avg;
    return svg(
      renderBadge(
        custom || `response ${RANGE_LABEL[range]}`,
        avg == null ? "no data" : `${avg} ms`,
        avg == null ? BADGE_COLORS.unknown : responseColor(avg)
      ),
      app.private
    );
  }

  // Live state, from the poller's current check of this app as configured.
  const c = latestCheck(app.id);
  const now = Date.now();
  const current =
    c && c.signature === checkSignature(app) && now - c.at <= 2 * minutes * 60_000 + POLL_SLACK_MS;
  const label = custom || app.name.slice(0, 40);
  if (!current) return svg(renderBadge(label, "unknown", BADGE_COLORS.unknown), app.private);
  const r = c.result;
  const [value, color] = r.up
    ? r.warning
      ? ["warning", BADGE_COLORS.fair]
      : ["up", BADGE_COLORS.up]
    : maintenanceApps(settings.statusAnnouncements, now).has(app.id)
      ? ["maintenance", BADGE_COLORS.maintenance]
      : ["down", BADGE_COLORS.down];
  return svg(renderBadge(label, value, color), app.private);
}
