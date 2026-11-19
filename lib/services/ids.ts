// The catalog of integration types (#212, #300): ids, labels and everything
// the admin form and the Monitor face need to know about a type, safe to
// import from client components (no clients, no credentials, no node-only
// code). The server half — snapshot, probe, detail — lives in ./registry.ts,
// keyed by the same ids.
//
// Adding a type: add its id and its SERVICE_META entry here, its client
// module, and its line in the registry; TypeScript walks you through the
// glance (components/monitor/glances.ts) and the detail body. Integrations
// themselves are instances (lib/schema/integrations.ts): any number of each
// type, each with its own id.

export const SERVICE_IDS = [
  "qbittorrent",
  "sonarr",
  "radarr",
  "adguard",
  "tautulli",
  "seerr",
  "portainer",
  "truenas",
  "unifi",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

// A health condition an integration can send alerts about (#540): its id in
// the integration's `alertOn` list, and the switch's words.
export type AlertCondition = { id: string; label: string; hint: string };

export type ServiceMeta = {
  label: string;
  // Which credentials it signs in with: a WebUI login, or an API key.
  credentials: "userPass" | "apiKey";
  // The admin form's copy.
  intro: string;
  urlLabel: string;
  placeholder: string;
  // Where to find the API key (API-key types).
  keyHint?: string;
  // Shown beside an http:// address, when sending the credentials over
  // plain http costs more than their privacy (TrueNAS, #560).
  httpWarning?: string;
  // The pre-3.0 environment variable for its secret. It still applies to the
  // integration whose id is the type's (the one a 2.x config migrated to).
  legacyEnv: string;
  // Has dashboard actions behind the allowActions opt-in (#201/#202/#203).
  actions?: boolean;
  // Offers "allow self-signed certificate" (HTTPS-only controllers).
  insecureTls?: boolean;
  // The Monitor face's cluster.
  group: (typeof MONITOR_GROUPS)[number];
  // What the service is, in a few words, under its name on its page (#508).
  tagline: string;
  // Its logo in the icon set (dashboard-icons slug).
  icon: string;
  // How often the Monitor refreshes it while a page is open (#531): about as
  // often as its numbers move, and no more than it can comfortably answer.
  liveMs: number;
  // What it can send alerts about (#540), each a switch on the integration,
  // off until it's turned on. Read on the server by lib/integration-alerts.ts.
  alertConditions?: AlertCondition[];
};

// The Monitor face's clusters, in order: the infrastructure leads, media
// follows.
export const MONITOR_GROUPS = ["Network", "Storage & Containers", "Media"] as const;

export const SERVICE_META: Record<ServiceId, ServiceMeta> = {
  qbittorrent: {
    label: "qBittorrent",
    credentials: "userPass",
    intro:
      "Transfer speeds and the active torrent list on the Monitor page. Turn on actions to pause, resume, and delete torrents.",
    urlLabel: "WebUI URL",
    placeholder: "http://192.168.1.10:8080",
    legacyEnv: "CTRLCENTER_QBITTORRENT_PASS",
    actions: true,
    group: "Media",
    tagline: "Downloads",
    icon: "qbittorrent",
    liveMs: 3_000,
  },
  sonarr: {
    label: "Sonarr",
    credentials: "apiKey",
    intro: "Download queue, missing episodes, and health warnings, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:8989",
    keyHint: "Sonarr → Settings → General → API Key.",
    legacyEnv: "CTRLCENTER_SONARR_KEY",
    group: "Media",
    tagline: "TV series",
    icon: "sonarr",
    liveMs: 30_000,
  },
  radarr: {
    label: "Radarr",
    credentials: "apiKey",
    intro: "Download queue, missing movies, and health warnings, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:7878",
    keyHint: "Radarr → Settings → General → API Key.",
    legacyEnv: "CTRLCENTER_RADARR_KEY",
    group: "Media",
    tagline: "Movies",
    icon: "radarr",
    liveMs: 30_000,
  },
  adguard: {
    label: "AdGuard Home",
    credentials: "userPass",
    intro: "DNS query volume, blocked share, and protection status, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:3000",
    legacyEnv: "CTRLCENTER_ADGUARD_PASS",
    group: "Network",
    tagline: "DNS filtering",
    icon: "adguard-home",
    liveMs: 10_000,
  },
  tautulli: {
    label: "Tautulli",
    credentials: "apiKey",
    intro:
      "Active Plex streams — who's watching, progress, and transcodes — read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:8181",
    keyHint: "Tautulli → Settings → Web Interface → API Key.",
    legacyEnv: "CTRLCENTER_TAUTULLI_KEY",
    group: "Media",
    tagline: "Plex activity",
    icon: "tautulli",
    liveMs: 5_000,
  },
  seerr: {
    label: "Seerr",
    credentials: "apiKey",
    intro:
      "Pending requests and their status on the Monitor page. Turn on actions to approve or deny requests. Seerr is the merged successor to Overseerr and Jellyseerr.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:5055",
    keyHint: "Seerr → Settings → General → API Key.",
    legacyEnv: "CTRLCENTER_SEERR_KEY",
    actions: true,
    group: "Media",
    tagline: "Media requests",
    icon: "seerr",
    liveMs: 30_000,
  },
  portainer: {
    label: "Portainer",
    credentials: "apiKey",
    intro:
      "Container states across every environment on the Monitor page. Turn on actions to start, stop, and restart containers and view their logs.",
    urlLabel: "URL",
    placeholder: "https://192.168.1.10:9443",
    keyHint: "Portainer → My account → Access tokens → Add access token.",
    legacyEnv: "CTRLCENTER_PORTAINER_KEY",
    actions: true,
    group: "Storage & Containers",
    tagline: "Containers",
    icon: "portainer",
    liveMs: 15_000,
  },
  truenas: {
    label: "TrueNAS",
    credentials: "apiKey",
    intro: "Pool health, capacity, and active alerts, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "https://192.168.1.10",
    keyHint: "TrueNAS → Settings → API Keys → Add.",
    httpWarning:
      "Plain http: TrueNAS 25.04 and later revoke an API key the first time it arrives over http, and it stays unusable until you reset it in TrueNAS. Use the https address.",
    legacyEnv: "CTRLCENTER_TRUENAS_KEY",
    group: "Storage & Containers",
    tagline: "Storage",
    icon: "truenas",
    liveMs: 30_000,
    alertConditions: [
      {
        id: "pool",
        label: "A pool isn't healthy",
        hint: "Degraded, faulted or offline. Cleared when it's healthy again.",
      },
      {
        id: "alert",
        label: "TrueNAS raises an alert",
        hint: "Its own alerts at warning or above, such as a failing disk or a degraded pool. Cleared when TrueNAS clears it.",
      },
      {
        id: "app",
        label: "An app stops or crashes",
        hint: "Cleared when it's running again.",
      },
    ],
  },
  unifi: {
    label: "UniFi",
    credentials: "userPass",
    intro:
      "Internet/WAN status, connected client count, and device health, read-only, on the Monitor page.",
    urlLabel: "Controller URL",
    placeholder: "https://192.168.1.1",
    legacyEnv: "CTRLCENTER_UNIFI_PASS",
    insecureTls: true,
    group: "Network",
    tagline: "Network",
    icon: "unifi",
    liveMs: 10_000,
  },
};

// The conditions an integration sends alerts about: those its `alertOn`
// names that its type has, in the type's order. None while it's off or has
// no address, as the Monitor then reads nothing from it.
export function alertConditionsOn(i: {
  type: ServiceId;
  enabled: boolean;
  url: string;
  alertOn?: readonly string[];
}): string[] {
  if (!i.enabled || i.url.trim() === "" || !i.alertOn?.length) return [];
  return (SERVICE_META[i.type].alertConditions ?? []).map((c) => c.id).filter((id) => i.alertOn?.includes(id));
}

export const SERVICE_LABELS = Object.fromEntries(
  SERVICE_IDS.map((id) => [id, SERVICE_META[id].label])
) as Record<ServiceId, string>;

// What the admin and the Monitor call each integration: its own name, else
// its type's label, numbered when several share it ("Sonarr 2").
export function integrationLabels(
  integrations: readonly { id: string; type: ServiceId; name: string }[]
): Record<string, string> {
  const base = integrations.map((i) => i.name.trim() || SERVICE_LABELS[i.type]);
  const seen = new Map<string, number>();
  const out: Record<string, string> = {};
  integrations.forEach((i, idx) => {
    const n = (seen.get(base[idx]) ?? 0) + 1;
    seen.set(base[idx], n);
    out[i.id] = n === 1 ? base[idx] : `${base[idx]} ${n}`;
  });
  return out;
}
