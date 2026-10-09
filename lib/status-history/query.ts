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
  oldestSampleMs,
  extractOutages,
} from "./aggregate";
import { appData, currentOutageStart, recordedOutages } from "./store";

// One app's history payload: uptime/latency windows (h1 from the raw ring, the
// rest from the hourly buckets) plus one `bars`-long strip per range. The day
// labels use `timeZone`'s calendar date. `intervalMinutes` is the poller
// cadence: a 1h reading holds for up to twice that, so normal polling paints a
// continuous strip while a stalled poller still shows a gap.
function appHistory(
  id: string,
  now: number,
  timeZone: string,
  intervalMinutes: number,
  bars: number
): AppHistory {
  const nowHour = hourOf(now);
  const recentSince = now - RECENT_VIEW_MS;
  const holdMs = 2 * intervalMinutes * MIN_MS;
  const dayAt = (ms: number) => localDayStr(ms, timeZone);
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
      d30: fixedBarsFromBuckets(buckets, now - 30 * DAY_MS, now, bars, dayAt),
      d90: fixedBarsFromBuckets(buckets, now - 90 * DAY_MS, now, bars, dayAt),
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
  return {
    generatedAt: now,
    apps: ids.map((id) => appHistory(id, now, timeZone, intervalOf(id), TIMELINE_BARS)),
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
    ...appHistory(id, now, timeZone, intervalMinutes, DETAIL_BARS),
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
