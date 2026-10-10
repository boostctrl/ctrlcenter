import type { AnnouncementTone } from "./schema";

// Per-tone tint + accent color, shared by the site-wide AnnouncementBanner and
// the /status page's announcement cards so both speak the same visual language.
// Backgrounds are translucent (they read on both light and dark surfaces).
// Each tone follows a theme token (#331): the semantic colors for info,
// warning and success, and the accent for `accent`.
export const ANNOUNCEMENT_TONE_STYLES: Record<
  AnnouncementTone,
  { bg: string; color: string }
> = {
  info: { bg: "color-mix(in srgb, var(--status-info) 12%, transparent)", color: "var(--status-info)" },
  warning: { bg: "color-mix(in srgb, var(--status-warning) 14%, transparent)", color: "var(--status-warning)" },
  success: { bg: "color-mix(in srgb, var(--status-up) 13%, transparent)", color: "var(--status-up)" },
  accent: {
    bg: "color-mix(in srgb, var(--accent-from) 14%, transparent)",
    color: "var(--accent-from)",
  },
};
