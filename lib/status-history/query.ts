// The uptime history's read side (#290 split): the /api/status/history
// payloads, aggregated from the store at request time.
import { TIMELINE_BARS, DETAIL_BARS } from "../status";
import type { StatusHistory, AppHistory, AppDetail } from "../status";
import {
  DAY_MS,
  MIN_MS,
  RECENT_VIEW_MS,
  hourOf,
  localDayStr,
  minuteStr,
  recentPct,
  recentLatency,
  dayWindows,
  latencyDayWindows,
  fixedBarsFromReadings,
  fixedBarsFromBuckets,
  barsFromBuckets,
  dayAlignedEdges,
  oldestSampleMs,
  extractOutages,
} from "./aggregate";
import { appData, currentOutageStart, recordedOutages } from "./store";

// The 30d and 90d strips' bar edges: the visitor's calendar days (#401), the
// last bar being today so far. They depend only on the request, so a payload
// of many apps computes them once.
type DayEdges = { d30: number[]; d90: number[] };
function dayEdgesFor(now: number, timeZone: string, bars: number): DayEdges {
  return {
    d30: dayAlignedEdges(now, timeZone, 30, bars),
    d90: dayAlignedEdges(now, timeZone, 90, bars),
  };
}

// One app's history payload: uptime/latency windows (h1 from the raw ring, the
// rest from the hourly buckets) plus one `bars`-long strip per range. The 1h
// and 24h strips are rolling windows ending now; the 30d and 90d strips are
// whole calendar days in `timeZone` (#401), so a bar reads as the date it is
// labelled with — a rolling 24 h span labelled by its start date put an
// outage at 08:00 on the 12th under the 11th. `intervalMinutes` is the poller
// cadence: a 1h reading holds for up to twice that, so normal polling paints a
// continuous strip while a stalled poller still shows a gap.
function appHistory(
  id: string,
  now: number,
  timeZone: string,
  intervalMinutes: number,
  bars: number,
  dayEdges: DayEdges
): AppHistory {
  const nowHour = hourOf(now);
  const recentSince = now - RECENT_VIEW_MS;
  const holdMs = 2 * intervalMinutes * MIN_MS;
  const dayAt = (ms: number) => localDayStr(ms, timeZone);
  // A bar of one or more whole days is labelled by its (first) calendar date;
  // a slice of a day — the detail page's 30d bars are thirds — by its start
  // instant, which the client shows as a time range like the 24h bars.
  const dayLabel = (days: number) => (bars <= days ? dayAt : minuteStr);
  const { buckets, readings } = appData(id);
  return {
    id,
    uptime: {
      h1: recentPct(readings, recentSince),
      ...dayWindows(buckets, nowHour),
    },
    // Latency windows parallel to `uptime`: h1 from the recent ring over the
    // same RECENT_VIEW_MS window, the day scales from the hourly buckets.
    latency: {
      h1: recentLatency(readings, recentSince),
      ...latencyDayWindows(buckets, nowHour),
    },
    series: {
      h1: fixedBarsFromReadings(readings, recentSince, now, bars, holdMs),
      d1: fixedBarsFromBuckets(buckets, now - DAY_MS, now, bars, minuteStr),
      d30: barsFromBuckets(buckets, dayEdges.d30, dayLabel(30)),
      d90: barsFromBuckets(buckets, dayEdges.d90, dayLabel(90)),
    },
    // How far back this app's data actually reaches, so the client can flag an
    // uptime % that covers less range than its toggle claims (see AppHistory).
    since: oldestSampleMs(buckets, readings),
    // Start of this app's current outage as the poller sees it, or null when
    // it was up at the last poll — the page turns this into "Down for 23m".
    downSince: currentOutageStart(id),
  };
}

// Read history for the given app ids (preserving order) as the API payload.
// Every strip is TIMELINE_BARS long — the 1h view resamples the raw ring, the
// day-scale views resample the hourly buckets — so all four ranges draw an
// identically-sized heartbeat.
// `intervalMinutes` may vary per app (#292).
export function getHistory(
  ids: string[],
  timeZone = "UTC",
  intervalMinutes: number | ((id: string) => number) = 5
): StatusHistory {
  const now = Date.now();
  const intervalOf = typeof intervalMinutes === "function" ? intervalMinutes : () => intervalMinutes;
  const dayEdges = dayEdgesFor(now, timeZone, TIMELINE_BARS);
  return {
    generatedAt: now,
    apps: ids.map((id) => appHistory(id, now, timeZone, intervalOf(id), TIMELINE_BARS, dayEdges)),
  };
}

// One app's detail payload (#150): the same history shape at the detail
// page's higher resolution, plus the derived outage log. Visibility is the
// caller's job — the API route 404s ids the caller may not see.
export function getAppDetail(
  id: string,
  timeZone = "UTC",
  intervalMinutes = 5
): AppDetail {
  const now = Date.now();
  const { buckets, readings } = appData(id);
  return {
    ...appHistory(
      id,
      now,
      timeZone,
      intervalMinutes,
      DETAIL_BARS,
      dayEdgesFor(now, timeZone, DETAIL_BARS)
    ),
    outages: extractOutages(
      recordedOutages(id),
      buckets,
      readings,
      currentOutageStart(id),
      now,
      intervalMinutes
    ),
  };
}
