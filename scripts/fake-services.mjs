// Sample data for every integration (#507): one local HTTP server that
// answers the API calls CtrlCenter's service clients make, each service under
// its own path prefix (`/sonarr`, `/radarr`, …), with realistic data — long
// names, many rows, warnings and errors, something offline — so the Monitor
// dashboard and every integration page can be seen populated.
//
// It is never part of the app: the smoke run (scripts/smoke.mjs) starts it
// and points its integrations at it, so the screenshots show real pages, and
// the data goes through the same clients and parsing a real install uses.
// Run on its own to look at the pages while developing:
//
//   node scripts/fake-services.mjs [port]
//
// prints the integrations to add (Settings → Integrations, or the JSON for
// PUT /api/integrations). Every name, address and number here is invented.
import http from "node:http";
import { pathToFileURL } from "node:url";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

// The credentials each fake service expects; a wrong one answers as the real
// service would, so a misconfigured integration shows its real error.
export const FAKE_KEY = "fake-api-key";
export const FAKE_USER = "fake-user";
export const FAKE_PASSWORD = "fake-password";

const iso = (ms) => new Date(ms).toISOString();
// A factor between 0.6 and 1.4 that moves smoothly over about a minute: the
// live numbers' wobble.
const drift = (phase = 0) => 1 + 0.4 * Math.sin(Date.now() / 9_000 + phase);
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// --- Sonarr and Radarr (/api/v3) ---

const SERIES = [
  "Severance",
  "The Expanse",
  "Slow Horses",
  "Shōgun",
  "Andor",
  "The Long and Winding Chronicles of the Northern Lighthouse Keepers",
  "Blue Eye Samurai",
  "Silo",
];
const MOVIES = [
  ["Dune: Part Two", 2024],
  ["Past Lives", 2023],
  ["The Zone of Interest", 2023],
  ["Perfect Days", 2023],
  ["A Very Long Title About an Expedition Across the Frozen Continent", 2025],
  ["Arrival", 2016],
  ["Aftersun", 2022],
];

function sonarr(path, now) {
  if (path.startsWith("/api/v3/calendar")) {
    return SERIES.map((title, i) => ({
      airDateUtc: iso(now + (i * 37 + 5) * HOUR),
      seasonNumber: 1 + (i % 3),
      episodeNumber: 2 + i,
      title: `Episode ${2 + i}`,
      series: { title, titleSlug: slug(title) },
    }));
  }
  if (path.startsWith("/api/v3/history")) {
    const events = ["downloadFolderImported", "grabbed", "episodeFileRenamed", "grabbed", "downloadFolderImported"];
    return {
      records: Array.from({ length: 25 }, (_, i) => ({
        eventType: events[i % events.length],
        date: iso(now - (i * 5 + 1) * HOUR),
        series: { title: SERIES[i % SERIES.length], titleSlug: slug(SERIES[i % SERIES.length]) },
        episode: { seasonNumber: 1 + (i % 2), episodeNumber: 1 + (i % 9) },
      })),
    };
  }
  if (path === "/api/v3/health") {
    return [
      { type: "warning", message: "Indexer Nyaa is unavailable due to failures for more than 6 hours" },
      { type: "notice", message: "Update available: 4.0.11 is ready to install" },
    ];
  }
  if (path.startsWith("/api/v3/queue")) {
    const rows = [
      ["Severance", 2, 3, "downloading", "ok", 0.62, "00:14:10"],
      ["The Expanse", 6, 1, "downloading", "ok", 0.18, "01:42:00"],
      ["Slow Horses", 4, 2, "completed", "warning", 1, null],
      ["Andor", 2, 7, "queued", "ok", 0, null],
    ];
    return {
      totalRecords: rows.length,
      records: rows.map(([title, s, e, status, tracked, done, timeleft]) => ({
        status,
        trackedDownloadStatus: tracked,
        size: 3.4 * GB,
        sizeleft: 3.4 * GB * (1 - done),
        timeleft,
        series: { title, titleSlug: slug(title) },
        episode: { seasonNumber: s, episodeNumber: e },
      })),
    };
  }
  if (path.startsWith("/api/v3/wanted/missing")) {
    return {
      totalRecords: 23,
      records: SERIES.slice(0, 6).map((title, i) => ({
        airDateUtc: iso(now - (i * 3 + 1) * 24 * HOUR),
        seasonNumber: 1 + (i % 3),
        episodeNumber: 4 + i,
        series: { title, titleSlug: slug(title) },
      })),
    };
  }
  if (path === "/api/v3/diskspace") {
    return [
      { path: "/tv", freeSpace: 1.9 * TB, totalSpace: 21.8 * TB },
      { path: "/downloads", freeSpace: 410 * GB, totalSpace: 1.8 * TB },
    ];
  }
  if (path === "/api/v3/series") {
    return Array.from({ length: 84 }, (_, i) => ({
      statistics: {
        episodeFileCount: 20 + ((i * 7) % 60),
        episodeCount: 22 + ((i * 7) % 60) + (i % 5 === 0 ? 4 : 0),
        totalEpisodeCount: 30 + ((i * 7) % 60) + (i % 3) * 6,
        sizeOnDisk: (40 + (i % 9) * 22) * GB,
      },
    }));
  }
  if (path === "/api/v3/system/status") return { appName: "Sonarr", version: "4.0.10.2544" };
  return undefined;
}

function radarr(path, now) {
  if (path.startsWith("/api/v3/calendar")) {
    return MOVIES.map(([title, year], i) => ({
      title,
      year,
      inCinemas: iso(now - 90 * DAY + i * DAY),
      digitalRelease: iso(now + (i * 2 + 1) * DAY),
      physicalRelease: iso(now + (i * 3 + 20) * DAY),
    }));
  }
  if (path.startsWith("/api/v3/history")) {
    const events = ["grabbed", "downloadFolderImported", "movieFileDeleted"];
    return {
      records: Array.from({ length: 25 }, (_, i) => ({
        eventType: events[i % events.length],
        date: iso(now - (i * 9 + 2) * HOUR),
        movie: { title: MOVIES[i % MOVIES.length][0], year: MOVIES[i % MOVIES.length][1] },
      })),
    };
  }
  if (path === "/api/v3/health") {
    return [
      { type: "error", message: "All download clients are unavailable due to failures" },
      { type: "warning", message: "Missing root folder: /data/media/movies-4k" },
    ];
  }
  if (path.startsWith("/api/v3/queue")) {
    return {
      totalRecords: 2,
      records: [
        { status: "downloading", trackedDownloadStatus: "ok", size: 58 * GB, sizeleft: 53 * GB, timeleft: "00:52:00", movie: { title: "Dune: Part Two", year: 2024, tmdbId: 693134 } },
        { status: "paused", trackedDownloadStatus: "ok", size: 12 * GB, sizeleft: 9 * GB, timeleft: null, movie: { title: "Aftersun", year: 2022, tmdbId: 965150 } },
      ],
    };
  }
  if (path.startsWith("/api/v3/wanted/missing")) {
    return {
      totalRecords: 4,
      records: MOVIES.slice(3, 7).map(([title, year], i) => ({ title, year, tmdbId: 1000 + i, digitalRelease: iso(now - (i * 20 + 9) * 24 * HOUR) })),
    };
  }
  if (path === "/api/v3/diskspace") {
    return [{ path: "/movies", freeSpace: 12.5 * TB, totalSpace: 43.6 * TB }];
  }
  if (path === "/api/v3/movie") {
    return Array.from({ length: 412 }, (_, i) => ({
      hasFile: i % 9 !== 0 && i % 14 !== 0,
      monitored: i % 14 !== 0,
      isAvailable: i % 27 !== 0,
      sizeOnDisk: i % 9 !== 0 && i % 14 !== 0 ? (6 + (i % 11) * 4) * GB : 0,
    }));
  }
  if (path === "/api/v3/system/status") return { appName: "Radarr", version: "5.14.0.9383" };
  return undefined;
}

// --- Seerr (/api/v1) ---

const REQUESTERS = ["Alex", "Sam", "Jordan Lee", "Priya", "Morgan"];
function seerr(path, now) {
  if (path === "/api/v1/request/count") return { pending: 3, approved: 6, processing: 2, available: 41, total: 52 };
  if (path.startsWith("/api/v1/request?")) {
    const filter = new URL(path, "http://x").searchParams.get("filter");
    // status 1 pending, 2 approved, 3 declined; media 2 pending, 3
    // processing, 4 partly available, 5 available.
    const rows = [
      [1, 2, "movie"],
      [1, 2, "tv"],
      [1, 2, "movie"],
      [2, 3, "tv"],
      [2, 3, "movie"],
      [2, 5, "movie"],
      [2, 5, "tv"],
      [2, 4, "tv"],
      [2, 5, "movie"],
      [3, 2, "movie"],
    ];
    return {
      results: rows
        .map((row, i) => [row, i])
        .filter(([[status]]) => filter !== "pending" || status === 1)
        .map(([[status, mediaStatus, type], i]) => ({
        id: 100 + i,
        status,
        type,
        createdAt: iso(now - (i * 7 + 1) * HOUR),
        media: { tmdbId: 5000 + i, mediaType: type, status: mediaStatus },
        requestedBy: { displayName: REQUESTERS[i % REQUESTERS.length] },
      })),
    };
  }
  const detail = /^\/api\/v1\/(movie|tv)\/(\d+)$/.exec(path);
  if (detail) {
    const n = Number(detail[2]) - 5000;
    return detail[1] === "tv" ? { name: SERIES[n % SERIES.length] } : { title: MOVIES[n % MOVIES.length][0] };
  }
  if (path === "/api/v1/status") return { version: "2.1.0" };
  return undefined;
}

// --- Tautulli (/api/v2?cmd=) ---

function tautulli(cmd, now) {
  const ok = (data) => ({ response: { result: "success", message: null, data } });
  if (cmd === "get_activity") {
    return ok({
      stream_count: "3",
      total_bandwidth: Math.round(31200 * drift(2)),
      sessions: [
        { friendly_name: "Alex", full_title: "Severance - Cold Harbor", state: "playing", transcode_decision: "direct play", progress_percent: String(Math.floor(Date.now() / 6_000) % 100), quality_profile: "Original", player: "Living Room", platform: "Apple TV", location: "lan" },
        { friendly_name: "Priya", full_title: "Dune: Part Two", state: "playing", transcode_decision: "transcode", progress_percent: "22", quality_profile: "8 Mbps 1080p", player: "Pixel 9", platform: "Android", location: "wan" },
        { friendly_name: "Jordan Lee", full_title: "The Long and Winding Chronicles of the Northern Lighthouse Keepers - The Keeper's Daughter", state: "paused", transcode_decision: "copy", progress_percent: "91", quality_profile: "Original" },
      ],
    });
  }
  if (cmd === "get_history") {
    return ok({
      data: Array.from({ length: 10 }, (_, i) => ({
        friendly_name: REQUESTERS[i % REQUESTERS.length],
        full_title: i % 2 ? MOVIES[i % MOVIES.length][0] : `${SERIES[i % SERIES.length]} - Episode ${i + 1}`,
        date: Math.floor((now - (i * 3 + 1) * HOUR) / 1000),
        transcode_decision: ["direct play", "transcode", "copy"][i % 3],
      })),
    });
  }
  if (cmd === "get_home_stats") {
    return ok([
      { stat_id: "top_users", rows: REQUESTERS.slice(0, 5).map((friendly_name, i) => ({ friendly_name, total_plays: 61 - i * 11, total_duration: (52 - i * 9) * 3600 })) },
      { stat_id: "top_platforms", rows: [["Apple TV", 88], ["Chrome", 41], ["Android", 33], ["Roku", 19], ["iOS", 12]].map(([platform, total_plays]) => ({ platform, total_plays })) },
    ]);
  }
  if (cmd === "get_libraries") {
    return ok([
      { section_name: "Movies", section_type: "movie", count: "412" },
      { section_name: "TV Shows", section_type: "show", count: "84" },
      { section_name: "Music", section_type: "artist", count: "230" },
      { section_name: "Home Videos and Family Archive", section_type: "movie", count: "57" },
    ]);
  }
  if (cmd === "get_plays_by_date") {
    const days = Array.from({ length: 14 }, (_, i) => iso(now - (13 - i) * 24 * HOUR).slice(0, 10));
    return ok({
      categories: days,
      series: [
        { name: "TV", data: days.map((_, i) => 3 + ((i * 5) % 7)) },
        { name: "Movies", data: days.map((_, i) => 1 + ((i * 3) % 4)) },
        { name: "Music", data: days.map((_, i) => (i % 4 === 0 ? 2 : 0)) },
      ],
    });
  }
  if (cmd === "get_tautulli_info") return ok({ tautulli_version: "v2.14.6" });
  return { response: { result: "error", message: `Unknown command ${cmd}`, data: {} } };
}

// --- qBittorrent (/api/v2) ---

const TORRENTS = [
  ["Severance.S02E07.Chikhai.Bardo.1080p.ATVP.WEB-DL.DDP5.1.H.264", "downloading", 0.42, 6.1e6],
  ["Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos", "downloading", 0.08, 11.4e6],
  ["The.Long.and.Winding.Chronicles.of.the.Northern.Lighthouse.Keepers.S01.COMPLETE.1080p.WEB-DL", "stalledDL", 0.71, 0],
  ["Andor.S02E03.1080p.DSNP.WEB-DL", "queuedDL", 0, 0],
  ["Past.Lives.2023.1080p.WEB-DL", "uploading", 1, 0],
  ["Arrival.2016.1080p.BluRay.x264", "stalledUP", 1, 0],
  ["debian-13.1.0-amd64-netinst.iso", "uploading", 1, 0],
  ["Slow.Horses.S04.1080p.ATVP.WEB-DL", "pausedUP", 1, 0],
  ["Aftersun.2022.1080p.MUBI.WEB-DL", "error", 0.33, 0],
  ["Silo.S02E05.1080p.ATVP.WEB-DL", "checkingDL", 0.12, 0],
  ["Blue.Eye.Samurai.S01.1080p.NF.WEB-DL", "stalledUP", 1, 0],
  ["ubuntu-24.04.2-desktop-amd64.iso", "uploading", 1, 0],
];
function qbittorrentMaindata() {
  const torrents = Object.fromEntries(
    TORRENTS.map(([name, state, progress, dlspeed], i) => [
      `hash${String(i).padStart(36, "0")}`,
      {
        name,
        state,
        progress,
        ratio: progress === 1 ? 0.4 + i * 0.37 : 0.02 * i,
        dlspeed: Math.round(dlspeed * drift(i)),
        upspeed: state === "uploading" ? Math.round((350_000 + i * 90_000) * drift(i + 1)) : 0,
        size: (2 + i * 3.5) * GB,
        eta: dlspeed > 0 ? Math.round(((1 - progress) * (2 + i * 3.5) * GB) / dlspeed) : 8640000,
        category: ["movies", "tv", "linux", "tv", ""][i % 5],
        tracker: `https://tracker-${i % 3}.example/announce?passkey=secret${i}`,
        num_seeds: (i * 7) % 40,
        num_leechs: (i * 3) % 11,
        added_on: Math.round(Date.now() / 1000) - (i + 1) * 5400,
      },
    ])
  );
  return {
    rid: 1,
    full_update: true,
    torrents,
    server_state: {
      // Speeds that drift over a minute, so a live refresh shows (#531).
      dl_info_speed: Math.round(17.5e6 * drift()),
      up_info_speed: Math.round(1.9e6 * drift(1)),
      dl_info_data: 48 * GB,
      up_info_data: 12 * GB,
      alltime_dl: 18.2 * TB,
      alltime_ul: 9.7 * TB,
      global_ratio: "0.53",
      free_space_on_disk: 2.4 * TB,
      connection_status: "connected",
    },
  };
}

// --- Portainer (/api) ---

const CONTAINERS = [
  ["/traefik", "running", "Up 12 days"],
  ["/ctrlcenter", "running", "Up 2 hours (healthy)"],
  ["/plex", "running", "Up 12 days"],
  ["/sonarr", "running", "Up 3 days"],
  ["/radarr", "running", "Up 3 days"],
  ["/qbittorrent-behind-the-vpn-with-a-long-container-name", "running", "Up 3 days (unhealthy)"],
  ["/gluetun", "running", "Up 3 days (healthy)"],
  ["/tautulli", "running", "Up 12 days"],
  ["/seerr", "exited", "Exited (1) 4 hours ago"],
  ["/watchtower", "exited", "Exited (0) 2 days ago"],
  ["/postgres", "running", "Up 12 days (healthy)"],
  ["/redis", "restarting", "Restarting (1) 20 seconds ago"],
];
function portainer(path) {
  if (path === "/api/endpoints") {
    return [
      { Id: 1, Name: "local", Snapshots: [{ RunningContainerCount: 9, StoppedContainerCount: 2, HealthyContainerCount: 3, UnhealthyContainerCount: 1, TotalContainerCount: 12, ImageCount: 31, VolumeCount: 18, StackCount: 5, DockerVersion: "27.3.1", TotalCPU: 16, TotalMemory: 64 * GB }] },
      { Id: 2, Name: "nas-edge", Snapshots: [{ RunningContainerCount: 4, StoppedContainerCount: 0, HealthyContainerCount: 2, UnhealthyContainerCount: 0, TotalContainerCount: 4, ImageCount: 6, VolumeCount: 4, StackCount: 2, DockerVersion: "26.1.4", TotalCPU: 4, TotalMemory: 8 * GB }] },
      { Id: 3, Name: "offsite-backup", Snapshots: [] },
    ];
  }
  if (path === "/api/stacks") {
    return [
      { Name: "media", Type: 2, EndpointId: 1, Status: 1 },
      { Name: "monitoring", Type: 2, EndpointId: 1, Status: 1 },
      { Name: "home-automation", Type: 2, EndpointId: 1, Status: 1 },
      { Name: "a-stack-with-a-rather-long-descriptive-name", Type: 2, EndpointId: 1, Status: 2 },
      { Name: "ingress", Type: 2, EndpointId: 1, Status: 1 },
      { Name: "backup-agents", Type: 2, EndpointId: 2, Status: 1 },
      { Name: "sync", Type: 2, EndpointId: 2, Status: 2 },
    ];
  }
  const list = /^\/api\/endpoints\/(\d+)\/docker\/containers\/json/.exec(path);
  if (list) {
    const rows = list[1] === "1" ? CONTAINERS : CONTAINERS.slice(0, 4);
    return rows.map(([name, state, status], i) => ({ Id: `${list[1]}c${String(i).padStart(62, "0")}`, Names: [name], State: state, Status: status }));
  }
  if (/\/logs\?/.test(path)) return "logs";
  return undefined;
}

// --- TrueNAS (/api/v2.0) ---

function truenas(path) {
  if (path === "/api/v2.0/pool") {
    return [
      {
        name: "tank", status: "ONLINE", healthy: true, size: 43.6 * TB, allocated: 31.1 * TB, free: 12.5 * TB,
        scan: { function: "SCRUB", state: "FINISHED", end_time: { $date: Date.now() - 3 * 24 * HOUR }, errors: 0 },
        topology: { data: [{ type: "RAIDZ2", children: ["sda", "sdb", "sdc", "sdd", "sde", "sdf"].map((disk) => ({ type: "DISK", disk })) }] },
      },
      {
        name: "fast", status: "ONLINE", healthy: true, size: 1.8 * TB, allocated: 0.4 * TB, free: 1.4 * TB,
        scan: { function: "SCRUB", state: "FINISHED", end_time: { $date: Date.now() - 10 * 24 * HOUR }, errors: 0 },
        topology: { data: [{ type: "MIRROR", children: [{ type: "DISK", disk: "nvme0n1" }, { type: "DISK", disk: "nvme1n1" }] }] },
      },
      {
        name: "backup", status: "DEGRADED", healthy: false, size: 21.8 * TB, allocated: 19.9 * TB, free: 1.9 * TB,
        scan: { function: "RESILVER", state: "FINISHED", end_time: { $date: Date.now() - 26 * HOUR }, errors: 3 },
        topology: { data: [{ type: "MIRROR", children: [{ type: "DISK", disk: "sdg" }, { type: "DISK", disk: "sdh" }] }] },
      },
    ];
  }
  if (path.startsWith("/api/v2.0/app")) {
    const app = (name, state, containers, upgrade = false) => ({
      name,
      state,
      upgrade_available: upgrade,
      active_workloads: {
        containers: containers.length,
        container_details: containers.map((service_name, i) => ({ id: `${name}-${i}`, service_name, image: `ghcr.io/example/${service_name}:latest`, state: state === "RUNNING" ? "running" : "exited" })),
      },
    });
    return [
      app("immich", "RUNNING", ["server", "machine-learning", "redis", "postgres"], true),
      app("nextcloud", "RUNNING", ["nextcloud", "cron", "postgres"]),
      app("home-assistant", "RUNNING", ["home-assistant"]),
      app("syncthing", "RUNNING", ["syncthing"], true),
      app("minio", "STOPPED", ["minio"]),
      app("paperless-ngx-with-a-long-application-name", "DEPLOYING", ["web", "broker"]),
      app("jellyfin", "RUNNING", ["jellyfin"]),
      app("vaultwarden", "CRASHED", ["vaultwarden"]),
    ];
  }
  if (path === "/api/v2.0/alert/list") {
    return [
      { level: "CRITICAL", formatted: "Pool backup state is DEGRADED: One or more devices has been removed by the administrator.", dismissed: false },
      { level: "WARNING", formatted: "Space usage for pool backup is 91%. Optimal pool performance requires used space remain below 80%.", dismissed: false },
      { level: "INFO", formatted: "Update to TrueNAS 25.04.2 is available.", dismissed: false },
      { level: "WARNING", formatted: "A dismissed alert that should not show.", dismissed: true },
    ];
  }
  if (path === "/api/v2.0/disk/temperatures") {
    return { sda: 36, sdb: 37, sdc: 41, sdd: 38, sde: 47, sdf: 39, sdg: 52, sdh: 44, nvme0n1: 49, nvme1n1: 46 };
  }
  if (path.startsWith("/api/v2.0/disk")) {
    return [
      ...["sda", "sdb", "sdc", "sdd", "sde", "sdf"].map((name) => ({ name, model: "WDC WD80EFPX-68C4ZN0", size: 8 * TB, type: "HDD" })),
      { name: "sdg", model: "ST12000VN0008-2YS101", size: 12 * TB, type: "HDD" },
      { name: "sdh", model: "ST12000VN0008-2YS101", size: 12 * TB, type: "HDD" },
      { name: "nvme0n1", model: "Samsung SSD 990 PRO 2TB", size: 2 * TB, type: "SSD" },
      { name: "nvme1n1", model: "Samsung SSD 990 PRO 2TB", size: 2 * TB, type: "SSD" },
      { name: "sdi", model: "Kingston DataTraveler (boot)", size: 64 * GB, type: "SSD" },
    ];
  }
  if (path === "/api/v2.0/system/info") {
    return { version: "TrueNAS-SCALE-25.04.1", hostname: "nas", model: "AMD Ryzen 7 5700G", uptime_seconds: 12 * 86400 + 4 * 3600, cores: 16, physmem: 64 * GB, loadavg: [2.41, 1.98, 1.76] };
  }
  return undefined;
}

// --- AdGuard Home (/control) ---

function adguard(path) {
  if (path === "/control/status") return { version: "v0.107.57", protection_enabled: true };
  if (path === "/control/stats") {
    // 24 hourly points, a daytime curve; about one in six blocked.
    const queries = Array.from({ length: 24 }, (_, h) => Math.round(900 + 1400 * Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2)) + (h % 5) * 60));
    const blocked = queries.map((q, h) => Math.round(q * (0.13 + (h % 4) * 0.02)));
    const domains = [
      "doubleclick.net",
      "app-measurement.com",
      "telemetry.example-smart-tv-vendor-with-a-very-long-domain.com",
      "graph.facebook.com",
      "ads.youtube.com",
      "metrics.icloud.com",
      "browser-intake-datadoghq.com",
      "settings-win.data.microsoft.com",
    ];
    return {
      time_units: "hours",
      num_dns_queries: queries.reduce((a, b) => a + b, 0),
      num_blocked_filtering: blocked.reduce((a, b) => a + b, 0),
      avg_processing_time: 0.0123,
      dns_queries: queries,
      blocked_filtering: blocked,
      top_blocked_domains: domains.map((d, i) => ({ [d]: Math.round(4200 / (i + 1)) })),
      top_queried_domains: ["api.github.com", "push.apple.com", "connectivitycheck.gstatic.com", "time.cloudflare.com", "a-very-long-subdomain-name.cdn.streaming-provider.example", "plex.tv", "one.one.one.one", "ghcr.io"].map((d, i) => ({ [d]: Math.round(9100 / (i + 1.5)) })),
      top_clients: ["living-room-tv", "192.168.1.42", "pixel-9", "nas", "work-laptop-with-a-long-hostname.lan", "ipad"].map((c, i) => ({ [c]: Math.round(12400 / (i + 1.2)) })),
      num_replaced_safebrowsing: 37,
      num_replaced_parental: 0,
    };
  }
  if (path === "/control/filtering/status") {
    return { filters: [{ enabled: true, rules_count: 152340 }, { enabled: true, rules_count: 48211 }, { enabled: false, rules_count: 9000 }] };
  }
  return undefined;
}

// --- UniFi Network (UniFi OS, /proxy/network) ---

function unifi(path) {
  const env = (data) => ({ meta: { rc: "ok" }, data });
  if (path === "/proxy/network/api/s/default/stat/health") {
    return env([
      { subsystem: "wlan", status: "ok", num_user: 15, num_guest: 2, num_iot: 1, num_adopted: 3, num_disconnected: 0, num_pending: 0 },
      { subsystem: "wan", status: "ok", num_gw: 1, num_adopted: 1, num_disconnected: 0, wan_ip: "203.0.113.24", isp_name: "Example Fiber", num_sta: 24, "rx_bytes-r": 8.4e6, "tx_bytes-r": 1.1e6 },
      { subsystem: "www", status: "ok", latency: 11 },
      { subsystem: "lan", status: "ok", num_user: 7, num_guest: 0, num_adopted: 4, num_disconnected: 0, num_pending: 0 },
      { subsystem: "vpn", status: "ok" },
    ]);
  }
  const devices = [
    { name: "Dream Machine Pro", model: "UDMPRO", type: "udm", state: 1, num_sta: 24, uptime: 1_900_000 },
    { name: "Living Room AP", type: "uap", state: 1, num_sta: 9, uptime: 860_000 },
    { name: "Office AP", type: "uap", state: 1, num_sta: 6, uptime: 860_000 },
    { name: "Garage AP (detached building)", type: "uap", state: 0, num_sta: 0, uptime: 0 },
    { name: "Rack Switch 24 PoE", type: "usw", state: 1, num_sta: 11, uptime: 1_900_000 },
    { name: "Desk Switch", type: "usw", state: 5, num_sta: 3, uptime: 4_200 },
  ];
  if (path === "/proxy/network/api/s/default/stat/device") return env(devices);
  if (path === "/proxy/network/v2/api/site/default/device") {
    return {
      network_devices: devices,
      protect_devices: [
        { name: "Front Door", state: 1 },
        { name: "Driveway", state: 1 },
        { name: "Back Garden", state: 0 },
      ],
      access_devices: [],
      unmanaged_devices: [{ name: "Printer", state: 0 }],
    };
  }
  if (path === "/proxy/network/v2/api/site/default/clients/active") {
    return [
      ...Array.from({ length: 13 }, (_, i) => ({
        type: "WIRELESS",
        is_wired: false,
        is_guest: i < 2,
        display_name: ["Living Room TV", "Pixel 9", "iPad", "Work Laptop With A Rather Long Hostname", "Kitchen Speaker", "Thermostat"][i % 6] + (i > 5 ? ` ${i}` : ""),
        ip: `192.168.1.${40 + i}`,
        essid: i < 2 ? "Guest" : i % 4 === 0 ? "IoT" : "Home",
        rx_bytes: (13 - i) * 3.1 * GB,
        tx_bytes: (13 - i) * 0.4 * GB,
        signal: -48 - i * 3,
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        type: "WIRED",
        is_wired: true,
        is_guest: false,
        display_name: ["NAS", "Proxmox", "Desktop", "Printer", "Hue Bridge", "Console", "Camera NVR"][i],
        ip: `192.168.1.${10 + i}`,
        network_name: "Default",
        rx_bytes: (7 - i) * 21 * GB,
        tx_bytes: (7 - i) * 9 * GB,
      })),
    ];
  }
  if (path === "/proxy/network/api/s/default/stat/sysinfo") return env([{ version: "9.0.114" }]);
  return undefined;
}

// --- The server ---

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    ...headers,
  });
  res.end(text);
}

// Whether a request carries the fake credentials the service expects.
function authorized(service, req, url) {
  const h = req.headers;
  switch (service) {
    case "sonarr":
    case "radarr":
    case "seerr":
      return h["x-api-key"] === FAKE_KEY;
    case "portainer":
      return h["x-api-key"] === FAKE_KEY;
    case "truenas":
      return h.authorization === `Bearer ${FAKE_KEY}`;
    case "tautulli":
      return url.searchParams.get("apikey") === FAKE_KEY;
    case "adguard":
      return h.authorization === `Basic ${Buffer.from(`${FAKE_USER}:${FAKE_PASSWORD}`).toString("base64")}`;
    case "qbittorrent":
    case "unifi":
      return /(?:^|;\s*)(SID|TOKEN)=fake-session/.test(h.cookie ?? "");
    default:
      return false;
  }
}

function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://fake.local");
  const [, service, ...rest] = url.pathname.split("/");
  const path = `/${rest.join("/")}${url.search}`;
  const bare = `/${rest.join("/")}`;
  const now = Date.now();

  // Sign-ins: qBittorrent's form login and UniFi OS's JSON one.
  if (service === "qbittorrent" && bare === "/api/v2/auth/login") {
    return send(res, 200, "Ok.", { "set-cookie": "SID=fake-session; HttpOnly; path=/" });
  }
  if (service === "unifi" && bare === "/api/auth/login") {
    return send(res, 200, {}, { "set-cookie": "TOKEN=fake-session; Path=/; HttpOnly" });
  }
  if (!authorized(service, req, url)) return send(res, 401, { error: "Unauthorized" });

  let body;
  switch (service) {
    case "sonarr":
      body = sonarr(path, now);
      break;
    case "radarr":
      body = radarr(path, now);
      break;
    case "seerr":
      body = seerr(path, now);
      break;
    case "tautulli":
      body = bare === "/api/v2" ? tautulli(url.searchParams.get("cmd") ?? "", now) : undefined;
      break;
    case "qbittorrent":
      if (bare === "/api/v2/sync/maindata") body = qbittorrentMaindata();
      else if (bare === "/api/v2/app/version") body = "v5.0.4";
      break;
    case "portainer":
      body = portainer(path);
      break;
    case "truenas":
      body = truenas(path);
      break;
    case "adguard":
      body = adguard(bare);
      break;
    case "unifi":
      body = unifi(bare);
      break;
  }
  if (body === undefined) return send(res, 404, { error: "Not found" });
  return send(res, 200, body);
}

// The integrations that use this server, in the shape PUT /api/integrations
// takes: one of each type, named as a real install might.
export function fakeIntegrations(base) {
  const row = (id, type, name, over = {}) => ({
    id,
    type,
    name,
    enabled: true,
    url: `${base}/${type}`,
    username: "",
    password: "",
    apiKey: "",
    allowInsecureTls: false,
    allowActions: false,
    ...over,
  });
  const key = { apiKey: FAKE_KEY };
  const login = { username: FAKE_USER, password: FAKE_PASSWORD };
  return [
    row("sonarr", "sonarr", "", key),
    row("radarr", "radarr", "", key),
    row("seerr", "seerr", "", key),
    row("tautulli", "tautulli", "", key),
    row("qbittorrent", "qbittorrent", "", login),
    row("portainer", "portainer", "", key),
    row("truenas", "truenas", "", key),
    row("adguard", "adguard", "", login),
    row("unifi", "unifi", "", login),
  ];
}

// Start the server on `port` (0 for any free one). Resolves to its base URL
// and a close function.
export function startFakeServices(port = 0, host = "127.0.0.1") {
  const server = http.createServer(handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: bound } = server.address();
      resolve({ base: `http://${host}:${bound}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// On its own: serve until stopped, and say how to connect.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { base } = await startFakeServices(Number(process.argv[2] ?? 4010));
  console.log(`Fake services on ${base}. Add these integrations (PUT /api/integrations, or by hand in Settings → Integrations):`);
  console.log(JSON.stringify(fakeIntegrations(base), null, 2));
}
