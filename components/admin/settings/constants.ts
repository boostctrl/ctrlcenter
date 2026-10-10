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
