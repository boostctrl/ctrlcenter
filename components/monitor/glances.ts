// The instrument content each service shows as a complication on the Monitor
// face (#208, #223, #226). One extractor per service turns the same snapshot
// the detail page renders into a compact tile: a headline center token + caption
// and one to three readout lines, plus a *purposeful* visual — a ring gauge where
// a real proportion exists, an upcoming bar strip or a breakdown bar where it
// doesn't. No tile shows a decorative ring around a bare count. The face stays
// glanceable; the full depth is one click away on /admin/monitor/[id].

import type { ServiceId } from "@/lib/services/ids";
import type { ServiceSnapshotMap } from "@/lib/services/registry";
import { formatSpeed, formatEta } from "./MonitorCard";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";

// A service's tile visual — chosen so it always means something:
//   spark    — a line sparkline over a per-unit series (AdGuard query volume)
//   days     — a next-7-days bar strip (Sonarr/Radarr upcoming, one bar per day)
//   segments — a stacked breakdown bar (Seerr pending/processing/available)
export type GlanceVisual =
  | { kind: "spark"; values: number[] }
  | { kind: "days"; values: number[] }
  | { kind: "segments"; parts: { value: number; tone: SegmentTone }[] };

export type SegmentTone = "pending" | "processing" | "available";

// A service's glance:
//   center  — the headline token (the ring center, or the badge number)
//   caption — the tiny label under it ("blocked", "upcoming", "clients")
//   ring    — 0..1 gauge fill for services with a natural proportion; omitted →
//             a plain number badge (a count service shows its visual instead)
//   alert   — tint the gauge/number danger (near-full capacity, WAN down, …)
//   lines   — 1–3 readout lines beside the headline; the first is the headline
//   visual  — the purposeful bottom visual, when the service has one
export type Glance = {
  center: string;
  caption: string;
  ring?: number;
  alert?: boolean;
  lines: string[];
  visual?: GlanceVisual;
};

// "45.2k" — compact, locale-independent (locale formatting hydrates differently
// between server and client).
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Local midnight for a timestamp — the day-bucket boundary for the upcoming strip.
const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// A relative day label for an upcoming air/release time — "today", "in 3d". Null
// when the time is missing, or before the client has mounted (`now` is null on
// the server render and first paint, so the string can't mismatch on hydration).
function whenLabel(at: number | null, now: number | null): string | null {
  if (at == null || now == null) return null;
  const days = Math.round((at - now) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  return `in ${Math.round(days / 7)}w`;
}

// Trim to a clean line, kept short so the readout column never has to wrap.
const line = (s: string): string => (s.length > 34 ? `${s.slice(0, 33)}…` : s);

// Each extractor takes its snapshot slice and `now` (for relative dates and the
// upcoming strip). Most ignore `now`; only the *arr tiles need it.
export const GLANCES: {
  [K in ServiceId]: (data: ServiceSnapshotMap[K], now: number | null) => Glance;
} = {
  qbittorrent: (d) => {
    const { total, downloading, seeding, paused, errored } = d.counts;
    if (total === 0)
      return { center: "0", caption: "torrents", lines: ["No torrents"] };
    const speeds = `↓ ${formatSpeed(d.downSpeed)}  ↑ ${formatSpeed(d.upSpeed)}`;
    // The snapshot's torrents are active-first, so the first downloading one is
    // the headline transfer — a "now downloading" line with its progress/ETA.
    const top = d.torrents.find((t) => t.state === "downloading");
    const lines = [speeds];
    if (top) {
      lines.push(line(top.name));
      lines.push(
        `${Math.round(top.progress * 100)}%${top.eta != null ? ` · ${formatEta(top.eta)}` : ""}`
      );
    } else {
      lines.push(`${seeding} seeding · ${paused} paused`);
      if (errored > 0) lines.push(`${errored} errored`);
    }
    return {
      center: String(downloading > 0 ? downloading : total),
      caption: downloading > 0 ? "downloading" : "torrents",
      ring: (downloading + seeding) / total,
      lines,
    };
  },
  sonarr: (d, now) => arrGlance(d, now),
  radarr: (d, now) => arrGlance(d, now),
  seerr: (d) => {
    const parts: { value: number; tone: SegmentTone }[] = [
      { value: d.pending, tone: "pending" },
      { value: d.processing, tone: "processing" },
      { value: d.available, tone: "available" },
    ];
    return {
      center: String(d.pending),
      caption: "pending",
      lines: [
        d.pending > 0 ? "Awaiting review" : "All caught up",
        `${d.totalRequests} total`,
      ],
      visual: { kind: "segments", parts },
    };
  },
  tautulli: (d) => {
    if (d.streamCount === 0)
      return { center: "0", caption: "streams", lines: ["Nothing playing"] };
    const top = d.sessions[0];
    const bandwidth =
      d.totalBandwidthKbps && d.totalBandwidthKbps > 0
        ? `${formatBytes((d.totalBandwidthKbps * 1000) / 8)}/s`
        : null;
    return {
      center: String(d.streamCount),
      caption: "streams",
      // The share of streams that are transcoding — the CPU-cost read.
      ring: d.transcodeCount / d.streamCount,
      alert: d.transcodeCount > 0 && d.transcodeCount === d.streamCount,
      lines: [
        top ? line(top.title) : `${plural(d.streamCount, "stream")} active`,
        line(
          [top?.user, d.transcodeCount > 0 ? plural(d.transcodeCount, "transcode") : null]
            .filter(Boolean)
            .join(" · ")
        ) || "Direct play",
        ...(bandwidth ? [bandwidth] : []),
      ].filter(Boolean),
    };
  },
  adguard: (d) => ({
    center: `${(d.blockedRatio * 100).toFixed(0)}%`,
    caption: "blocked",
    ring: d.blockedRatio,
    alert: !d.protectionEnabled,
    lines: [
      d.protectionEnabled ? `${compact(d.totalQueries)} queries` : "⚠ Protection off",
      ...(d.avgProcessingMs != null
        ? [`${d.avgProcessingMs.toFixed(0)} ms avg`]
        : d.topBlocked[0]
          ? [line(d.topBlocked[0].domain)]
          : []),
    ],
    visual: d.series.length > 1 ? { kind: "spark", values: d.series } : undefined,
  }),
  unifi: (d) => {
    const { total, wireless, wired } = d.clients;
    const wan = d.internet.up
      ? `${d.internet.isp ?? "Online"}${d.internet.latencyMs != null ? ` · ${d.internet.latencyMs} ms` : ""}`
      : "Internet down";
    const devices =
      d.devices.disconnected > 0
        ? `${plural(d.devices.disconnected, "device")} down`
        : `${plural(d.devices.adopted, "device")} online`;
    return {
      center: String(total),
      caption: "clients",
      ring: total > 0 ? wireless / total : undefined,
      alert: !d.internet.up || d.devices.disconnected > 0,
      lines: [`${wireless} wifi · ${wired} wired`, line(wan), devices],
    };
  },
  truenas: (d) => {
    const ratios = d.pools.map((p) => p.usedRatio ?? 0);
    const fullest = ratios.length > 0 ? Math.max(...ratios) : null;
    const totalFree = d.pools.reduce((sum, p) => sum + (p.free ?? 0), 0);
    const down = d.apps.filter((a) => !a.running).length;
    const upgrades = d.apps.filter((a) => a.upgradeAvailable).length;
    const critical = d.alerts.some((a) => a.level === "critical");
    const lines = [
      `${plural(d.pools.length, "pool")}${totalFree > 0 ? ` · ${formatBytes(totalFree)} free` : ""}`,
    ];
    if (d.apps.length > 0)
      lines.push(`${plural(d.apps.length, "app")}${down > 0 ? ` · ${down} down` : ""}`);
    if (d.alerts.length > 0) lines.push(plural(d.alerts.length, "alert"));
    else if (upgrades > 0) lines.push(`${plural(upgrades, "update")} ready`);
    return {
      center: fullest != null ? `${Math.round(fullest * 100)}%` : String(d.pools.length),
      caption: fullest != null ? "capacity" : "pools",
      ring: fullest ?? undefined,
      alert: (fullest ?? 0) >= 0.9 || critical,
      lines,
    };
  },
  portainer: (d) => {
    const { running, stopped, unhealthy, total } = d.totals;
    return {
      center: String(running),
      caption: "running",
      ring: total > 0 ? running / total : undefined,
      alert: unhealthy > 0,
      lines: [
        stopped > 0 ? `${stopped} stopped` : `${total} total`,
        ...(unhealthy > 0
          ? [`${unhealthy} unhealthy`]
          : d.endpoints.length > 1
            ? [`${plural(d.endpoints.length, "environment")}`]
            : []),
      ],
    };
  },
};

// Sonarr and Radarr share a glance: the upcoming count as a headline, the next
// title with when it lands, a recent/health tail, and a next-7-days bar strip.
function arrGlance(d: ServiceSnapshotMap["sonarr"], now: number | null): Glance {
  const next = d.upcoming[0];
  const warnings = d.health.length;
  // Only a health *error* alarms; a warning (a stale branch, an unmapped root
  // folder) is routine and shouldn't read as a failure.
  const errors = d.health.filter((h) => h.type === "error").length;

  // Bucket the upcoming items into the next seven days for the strip. Before the
  // client mounts `now` is null, so every bar is empty — matching the server
  // render, then filling in once mounted.
  const days = Array<number>(7).fill(0);
  if (now != null) {
    const base = startOfDay(now);
    for (const it of d.upcoming) {
      if (it.at == null) continue;
      const offset = Math.round((startOfDay(it.at) - base) / 86_400_000);
      if (offset >= 0 && offset < 7) days[offset] += 1;
    }
  }
  const visual: GlanceVisual = { kind: "days", values: days };

  if (!next) {
    return {
      center: "0",
      caption: "upcoming",
      alert: errors > 0,
      lines: [
        d.recent.length > 0 ? `${plural(d.recent.length, "recent")}` : "Nothing scheduled",
        ...(warnings > 0 ? [plural(warnings, "warning")] : []),
      ],
      visual,
    };
  }
  const when = whenLabel(next.at, now);
  return {
    center: String(d.upcoming.length),
    caption: "upcoming",
    alert: errors > 0,
    lines: [
      line(next.title),
      line([when, next.subtitle].filter(Boolean).join(" · ")) || "Scheduled",
      ...(d.recent.length > 0
        ? [`${plural(d.recent.length, "recent")}`]
        : warnings > 0
          ? [plural(warnings, "warning")]
          : []),
    ].filter(Boolean),
    visual,
  };
}
