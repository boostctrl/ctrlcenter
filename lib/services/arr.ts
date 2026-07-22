// Typed client for the Sonarr and Radarr v3 APIs (#191) — one implementation,
// because the two expose identical shapes for everything the monitor needs
// (queue, wanted/missing, health, system status). Server-side only; the API
// key never reaches the browser.

import {
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";

export type ArrKind = "sonarr" | "radarr";

export type ArrConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as CTRLCENTER_SMTP_PASS / CTRLCENTER_CALDAV_PASS.
export function resolveArrApiKey(kind: ArrKind, cfg: { apiKey: string }): string {
  const env =
    kind === "sonarr"
      ? process.env.CTRLCENTER_SONARR_KEY
      : process.env.CTRLCENTER_RADARR_KEY;
  return env || cfg.apiKey;
}

export type ArrQueueItem = {
  title: string;
  // The service's own status word ("downloading", "queued", "warning", …).
  status: string;
  // Completion 0..1, or null when the record reports no sizes.
  progress: number | null;
  // The service's remaining-time string ("00:12:34"), or null.
  timeLeft: string | null;
};

export type ArrHealthItem = { type: "warning" | "error"; message: string };

export type ArrSnapshot = {
  // Total records in the download queue (the list below is capped).
  queueCount: number;
  queue: ArrQueueItem[];
  // Monitored-but-missing episodes/movies.
  missingCount: number;
  health: ArrHealthItem[];
};

export const ARR_QUEUE_CAP = 6;
const HEALTH_CAP = 5;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawQueuePage = { totalRecords?: number; records?: RawQueueRecord[] };
type RawQueueRecord = {
  title?: string;
  status?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
};
type RawWantedPage = { totalRecords?: number };
type RawHealth = { type?: string; message?: string };

async function arrJson<T>(
  kind: ArrKind,
  cfg: ArrConfig,
  path: string
): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: { "X-Api-Key": resolveArrApiKey(kind, cfg) },
    });
  } catch (e) {
    // 401 has exactly one meaning here; say it in the admin's terms.
    if (e instanceof ServiceError && e.message === "HTTP 401") {
      throw new ServiceError("Invalid API key");
    }
    throw e;
  }
}

function mapQueue(page: RawQueuePage): { count: number; items: ArrQueueItem[] } {
  const records = Array.isArray(page.records) ? page.records : [];
  const items = records.slice(0, ARR_QUEUE_CAP).map((r): ArrQueueItem => {
    const size = typeof r.size === "number" ? r.size : 0;
    const left = typeof r.sizeleft === "number" ? r.sizeleft : null;
    return {
      title: typeof r.title === "string" && r.title !== "" ? r.title : "(unnamed)",
      status: typeof r.status === "string" ? r.status : "unknown",
      progress:
        size > 0 && left !== null
          ? Math.min(1, Math.max(0, (size - left) / size))
          : null,
      timeLeft: typeof r.timeleft === "string" && r.timeleft !== "" ? r.timeleft : null,
    };
  });
  return {
    count:
      typeof page.totalRecords === "number" ? page.totalRecords : items.length,
    items,
  };
}

function mapHealth(raw: RawHealth[]): ArrHealthItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h) => typeof h.message === "string" && h.message !== "")
    .map(
      (h): ArrHealthItem => ({
        // Anything that isn't explicitly an error reads as a warning.
        type: h.type === "error" ? "error" : "warning",
        message: h.message as string,
      })
    )
    .slice(0, HEALTH_CAP);
}

export async function getArrSnapshot(
  kind: ArrKind,
  cfg: ArrConfig
): Promise<ArrSnapshot> {
  const [queueR, missingR, healthR] = await Promise.allSettled([
    arrJson<RawQueuePage>(
      kind,
      cfg,
      `/api/v3/queue?page=1&pageSize=${ARR_QUEUE_CAP}`
    ),
    // Only the total is needed; ask for the smallest possible page.
    arrJson<RawWantedPage>(kind, cfg, "/api/v3/wanted/missing?page=1&pageSize=1"),
    arrJson<RawHealth[]>(kind, cfg, "/api/v3/health"),
  ]);
  // Queue and missing are the card's core numbers — if either can't be read
  // the card has nothing honest to show, so surface that failure. Health is
  // advisory (warning banners), so a flaky /health endpoint degrades to "no
  // warnings" rather than blanking the whole card: one failing sub-request no
  // longer takes the other two down with it (Promise.all did).
  if (queueR.status === "rejected") throw queueR.reason;
  if (missingR.status === "rejected") throw missingR.reason;
  const q = mapQueue(queueR.value);
  return {
    queueCount: q.count,
    queue: q.items,
    missingCount:
      typeof missingR.value.totalRecords === "number"
        ? missingR.value.totalRecords
        : 0,
    health: healthR.status === "fulfilled" ? mapHealth(healthR.value) : [],
  };
}

// Fresh reachability check for the admin's "Test connection" button. The
// system/status endpoint requires the API key and names the app, so success
// proves both the key and that it's really a Sonarr/Radarr on the other end.
export async function probeArr(
  kind: ArrKind,
  cfg: ArrConfig
): Promise<ProbeResult> {
  return runProbe(kind, async () => {
    const status = await arrJson<{ appName?: string; version?: string }>(
      kind,
      cfg,
      "/api/v3/system/status"
    );
    const name =
      typeof status.appName === "string" && status.appName !== ""
        ? status.appName
        : kind === "sonarr"
          ? "Sonarr"
          : "Radarr";
    const version = typeof status.version === "string" ? ` ${status.version}` : "";
    return `${name}${version}`;
  });
}
