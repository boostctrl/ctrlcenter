import type { Settings } from "./schema";

// Which admin-gated pages the floating nav should offer. Help and Settings always
// appear, and the nav adds the Dashboard link itself; these three depend on
// whether the admin has enabled the feature.
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
