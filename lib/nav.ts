import type { InstanceOf, Settings, WidgetInstance } from "./schema";
import { resolveLayout } from "./layout";

// The calendar widgets on show with a feed to fetch (#297): any number of
// them, and together they make up the /calendar page. A calendar hidden on the
// board is off.
export function activeCalendars(
  settings: Settings,
  widgets: readonly WidgetInstance[]
): InstanceOf<"calendar">[] {
  const shown = new Set(
    resolveLayout(settings.layout.sections, widgets)
      .filter((w) => !w.hidden)
      .map((w) => w.id)
  );
  return widgets.filter(
    (w): w is InstanceOf<"calendar"> =>
      w.type === "calendar" && shown.has(w.id) && w.url.trim() !== ""
  );
}

// Which admin-gated pages the navigation surfaces (the floating corner menu
// and the PageNav subpage strip) should offer. Help and Settings always
// appear, and each surface adds the Dashboard link itself; these three depend
// on whether the admin has enabled the feature. One helper for both surfaces
// so they can't drift.
export function navPages(
  settings: Settings,
  widgets: readonly WidgetInstance[]
): {
  weather: boolean;
  status: boolean;
  calendar: boolean;
} {
  return {
    weather: settings.weather.enabled,
    status: settings.statusChecks,
    calendar: activeCalendars(settings, widgets).length > 0,
  };
}

// The anchor id a settings Card carries (components/admin/ui.tsx), derived
// from its title. Links elsewhere — the Monitor's "Set up" buttons (#277) —
// deep-link to one card via `#<id>`, which SettingsManager scrolls to on load.
export function settingsCardId(title: string): string {
  return (
    "settings-card-" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}
