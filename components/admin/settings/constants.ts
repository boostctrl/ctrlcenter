import { announcementState } from "@/lib/status-announcements";

// One nav entry per settings group; a single group shows at a time. The
// grouping rule (#180), ordered identity → layout → content → operations →
// communication → account: General is the site's identity and default look;
// Home layout is which widgets show and how they're arranged; a card lives
// under Widgets iff it configures what a home-page widget SHOWS; Monitoring
// is the uptime infrastructure — status checks and their alerts are a
// service, not widget content; Announcements gathers the two "tell visitors
// something" surfaces (the site-wide banner and the status page's notices).
// The blurb renders under the section header in the content pane.
export const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    blurb: "Site identity and the default look visitors see.",
  },
  {
    id: "layout",
    label: "Home layout",
    blurb: "Which widgets show on the home page, and how they're arranged.",
  },
  {
    id: "widgets",
    label: "Widgets",
    blurb: "What each home-page widget shows.",
  },
  {
    id: "monitoring",
    label: "Monitoring",
    blurb: "Uptime checks on your apps, and alerts when one goes down.",
  },
  {
    id: "integrations",
    label: "Integrations",
    blurb:
      "Connections to your self-hosted services, shown on the private Monitor page — signed-in admins only.",
  },
  {
    id: "announcements",
    label: "Announcements",
    blurb: "Notices to visitors — a site-wide banner, or updates on the status page.",
  },
  {
    id: "security",
    label: "Security",
    blurb: "The password that guards this portal.",
  },
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

// The banner section used to be "announcement" (singular, pre-#180); keep
// saved deep links to it working.
export const LEGACY_SECTION_ALIASES: Record<string, SettingsSectionId> = {
  announcement: "announcements",
};

// Integration settings cards render from these two tables — one per
// credential shape (#212). The cards are identical apart from the strings, so
// a new service joins a table instead of adding a hand-kept copy.
export const USER_PASS_INTEGRATION_CARDS: readonly {
  id: "qbittorrent" | "adguard" | "unifi";
  title: string;
  intro: string;
  urlLabel: string;
  placeholder: string;
  envVar: string;
  // Show the "allow self-signed certificate" toggle for HTTPS-only
  // controllers that ship a self-signed cert (UniFi).
  insecureToggle?: boolean;
  // Show the write-action opt-in toggle for services with dashboard actions
  // (#201/#202/#203). Default off — the card stays read-only until turned on.
  actionsToggle?: boolean;
}[] = [
  {
    id: "qbittorrent",
    title: "qBittorrent",
    intro:
      "Transfer speeds and the active torrent list on the Monitor page. Turn on actions to pause, resume, and delete torrents.",
    urlLabel: "WebUI URL",
    placeholder: "http://192.168.1.10:8080",
    envVar: "CTRLCENTER_QBITTORRENT_PASS",
    actionsToggle: true,
  },
  {
    id: "adguard",
    title: "AdGuard Home",
    intro:
      "DNS query volume, blocked share, and protection status, read-only, on the Monitor page.",
    urlLabel: "URL",
    placeholder: "http://192.168.1.10:3000",
    envVar: "CTRLCENTER_ADGUARD_PASS",
  },
  {
    id: "unifi",
    title: "UniFi",
    intro:
      "Internet/WAN status, connected client count, and device health, read-only, on the Monitor page.",
    urlLabel: "Controller URL",
    placeholder: "https://192.168.1.1",
    envVar: "CTRLCENTER_UNIFI_PASS",
    insecureToggle: true,
  },
];

export const API_KEY_INTEGRATION_CARDS: readonly {
  id: "sonarr" | "radarr" | "tautulli" | "seerr" | "portainer" | "truenas";
  title: string;
  intro: string;
  placeholder: string;
  keyHint: string;
  envVar: string;
  // Show the write-action opt-in toggle for services with dashboard actions
  // (#201/#202/#203). Default off — the card stays read-only until turned on.
  actionsToggle?: boolean;
}[] = [
  {
    id: "sonarr",
    title: "Sonarr",
    intro:
      "Download queue, missing episodes, and health warnings, read-only, on the Monitor page.",
    placeholder: "http://192.168.1.10:8989",
    keyHint: "Sonarr → Settings → General → API Key.",
    envVar: "CTRLCENTER_SONARR_KEY",
  },
  {
    id: "radarr",
    title: "Radarr",
    intro:
      "Download queue, missing movies, and health warnings, read-only, on the Monitor page.",
    placeholder: "http://192.168.1.10:7878",
    keyHint: "Radarr → Settings → General → API Key.",
    envVar: "CTRLCENTER_RADARR_KEY",
  },
  {
    id: "tautulli",
    title: "Tautulli",
    intro:
      "Active Plex streams — who's watching, progress, and transcodes — read-only, on the Monitor page.",
    placeholder: "http://192.168.1.10:8181",
    keyHint: "Tautulli → Settings → Web Interface → API Key.",
    envVar: "CTRLCENTER_TAUTULLI_KEY",
  },
  {
    id: "seerr",
    title: "Seerr",
    intro:
      "Pending requests and their status on the Monitor page. Turn on actions to approve or deny requests. Seerr is the merged successor to Overseerr and Jellyseerr.",
    placeholder: "http://192.168.1.10:5055",
    keyHint: "Seerr → Settings → General → API Key.",
    envVar: "CTRLCENTER_SEERR_KEY",
    actionsToggle: true,
  },
  {
    id: "portainer",
    title: "Portainer",
    intro:
      "Container states across every environment on the Monitor page. Turn on actions to start, stop, and restart containers and view their logs.",
    placeholder: "https://192.168.1.10:9443",
    keyHint: "Portainer → My account → Access tokens → Add access token.",
    envVar: "CTRLCENTER_PORTAINER_KEY",
    actionsToggle: true,
  },
  {
    id: "truenas",
    title: "TrueNAS",
    intro:
      "Pool health, capacity, and active alerts, read-only, on the Monitor page.",
    placeholder: "http://192.168.1.10",
    keyHint: "TrueNAS → Settings → API Keys → Add.",
    envVar: "CTRLCENTER_TRUENAS_KEY",
  },
];

// Offered uptime-check intervals (minutes). The schema accepts 1–60, so a
// hand-edited value can fall outside this list — the control shows it as an
// extra read-only chip rather than pretending nothing is selected.
export const INTERVAL_PRESETS: readonly number[] = [1, 5, 15];

export const TONE_LABELS: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  success: "Success",
  accent: "Accent (theme color)",
};

export const STATUS_STATE_LABELS: Record<
  ReturnType<typeof announcementState>,
  string
> = { active: "Active", scheduled: "Scheduled", expired: "Expired" };
