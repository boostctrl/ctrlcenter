import type { Settings } from "./schema";

// Which admin-gated pages the navigation surfaces (the floating corner menu
// and the PageNav subpage strip) should offer. Help and Settings always
// appear, and each surface adds the Dashboard link itself; these three depend
// on whether the admin has enabled the feature. One helper for both surfaces
// so they can't drift.
export function navPages(settings: Settings): {
  weather: boolean;
  status: boolean;
  calendar: boolean;
} {
  return {
    weather: settings.weather.enabled,
    status: settings.statusChecks,
    calendar: settings.calendar.enabled && settings.calendar.url.trim() !== "",
  };
}
