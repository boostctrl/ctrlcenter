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
  // The pre-3.0 environment variable for its secret. It still applies to the
  // integration whose id is the type's (the one a 2.x config migrated to).
  legacyEnv: string;
  // Has dashboard actions behind the allowActions opt-in (#201/#202/#203).
  actions?: boolean;
  // Offers "allow self-signed certificate" (HTTPS-only controllers).
  insecureTls?: boolean;
  // The Monitor face's cluster.
  group: (typeof MONITOR_GROUPS)[number];
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
  },
  adguard: {
    label: "AdGuard Home",
    credentials: "userPass",
    intro: "DNS query volume, blocked share, and protection status, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:3000",
    legacyEnv: "CTRLCENTER_ADGUARD_PASS",
    group: "Network",
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
  },
  truenas: {
    label: "TrueNAS",
    credentials: "apiKey",
    intro: "Pool health, capacity, and active alerts, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10",
    keyHint: "TrueNAS → Settings → API Keys → Add.",
    legacyEnv: "CTRLCENTER_TRUENAS_KEY",
    group: "Storage & Containers",
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
  },
};

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
