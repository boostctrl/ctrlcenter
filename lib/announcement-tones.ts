import type { AnnouncementTone } from "./schema";

// Per-tone tint + accent color, shared by the site-wide AnnouncementBanner and
// the /status page's announcement cards so both speak the same visual language.
// Backgrounds are translucent (they read on both light and dark surfaces); the
// `accent` tone follows the theme's accent variable.
export const ANNOUNCEMENT_TONE_STYLES: Record<
  AnnouncementTone,
  { bg: string; color: string }
> = {
  info: { bg: "rgba(56,189,248,0.12)", color: "#38bdf8" },
  warning: { bg: "rgba(251,191,36,0.14)", color: "#f59e0b" },
  success: { bg: "rgba(52,211,153,0.13)", color: "#10b981" },
  accent: {
    bg: "color-mix(in srgb, var(--accent-from) 14%, transparent)",
    color: "var(--accent-from)",
  },
};
