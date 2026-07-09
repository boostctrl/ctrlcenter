"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Settings, StatusAnnouncementKind } from "@/lib/schema";
import {
  ALERT_TYPES,
  ANNOUNCEMENT_TONES,
  STATUS_ANNOUNCEMENT_KINDS,
} from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import {
  SEARCH_ENGINES,
  SEARCH_ENGINE_KEYS,
  type SearchEngine,
} from "@/lib/search";
import { STATUS_RANGES } from "@/lib/status";
import { announcementState } from "@/lib/status-announcements";
import { supportedTimezones, newThemeId } from "@/lib/prefs";
import { resolveLayoutWidgets, type LayoutWidgetId } from "@/lib/layout";
import { TextField } from "./ui";
import IconField from "./IconField";
import CalendarTest from "./CalendarTest";
import FeedTest from "./FeedTest";
import AlertTest from "./AlertTest";
import CitySearch from "./CitySearch";
import ChangePassword from "./ChangePassword";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";
import { useAutosave, SaveStatus, type SaveOptions } from "./useAutosave";

async function saveSettings(settings: Settings, opts?: SaveOptions): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    keepalive: opts?.keepalive,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Failed to save settings"));
  }
}

// One nav entry per settings group; a single group shows at a time. Related
// settings are grouped so the rail stays short: Appearance folds into General,
// the content-card widgets share Widgets, and Status + Alerts share Monitoring.
const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "layout", label: "Home layout" },
  { id: "widgets", label: "Widgets" },
  { id: "weather", label: "Weather" },
  { id: "monitoring", label: "Monitoring" },
  { id: "search", label: "Search" },
  { id: "announcement", label: "Announcement" },
  { id: "security", label: "Security" },
] as const;
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

// Groups that render more than one card: their cards flow into a two-column
// masonry so they fill the width. The rest are single, simpler forms and are
// centered at a comfortable reading width instead of stranded on the left.
const MULTI_CARD_SECTIONS: readonly SettingsSectionId[] = [
  "general",
  "layout",
  "widgets",
  "monitoring",
  "search",
];

// Offered uptime-check intervals (minutes). The schema accepts 1–60, so a
// hand-edited value can fall outside this list — the control shows it as an
// extra read-only chip rather than pretending nothing is selected.
const INTERVAL_PRESETS: readonly number[] = [1, 5, 15];

const TONE_LABELS: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  success: "Success",
  accent: "Accent (theme color)",
};

const STATUS_KIND_LABELS: Record<StatusAnnouncementKind, string> = {
  maintenance: "Maintenance",
  incident: "Incident",
  info: "Notice",
};

const STATUS_STATE_LABELS: Record<
  ReturnType<typeof announcementState>,
  string
> = { active: "Active", scheduled: "Scheduled", expired: "Expired" };

// <input type="datetime-local"> shows/edits a local wall-clock string with no
// zone, but a window is stored as a UTC ISO instant. Convert both directions
// in the browser's own zone so a value round-trips to the same wall-clock time.
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value); // a zone-less datetime-local is parsed as local
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-card mb-4 flex break-inside-avoid flex-col gap-4 p-5">
      <div>
        <h3 className="text-xs font-semibold tracking-[0.15em] text-fg/45 uppercase">
          {title}
        </h3>
        {intro && <p className="mt-1.5 text-xs text-fg/40">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsManager({
  initialSettings,
  themePacks,
}: {
  initialSettings: Settings;
  themePacks: ThemePack[];
}) {
  // Resolve the layout up front: stored entries can omit `hidden` (the legacy
  // components toggles fold in at resolve time), but this form autosaves the
  // WHOLE settings object and the strict layout update schema requires every
  // widget fully resolved.
  const [settings, setSettings] = useState(() => ({
    ...initialSettings,
    layout: {
      // Keep columns/scale — this form autosaves the whole layout object, so
      // dropping them here would reset them on the next save.
      ...initialSettings.layout,
      sections: resolveLayoutWidgets(
        initialSettings.layout.sections,
        initialSettings.components
      ),
    },
  }));
  const [section, setSection] = useState<SettingsSectionId>("general");
  // A ticking clock so each announcement's derived state chip (Active /
  // Scheduled / Expired) stays current without a reload, and so `Date.now()`
  // isn't called impurely during render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Persistence is automatic: every change debounce-saves via useAutosave.
  const { status, error } = useAutosave(settings, saveSettings);
  const confirm = useConfirm();
  const zones = useMemo(() => supportedTimezones(), []);

  const selectClass =
    "accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors";

  const theme = settings.theme;
  const updateTheme = (patch: Partial<Settings["theme"]>) =>
    setSettings((s) => ({ ...s, theme: { ...s.theme, ...patch } }));

  const alerts = settings.alerts;
  const updateAlerts = (patch: Partial<Settings["alerts"]>) =>
    setSettings((s) => ({ ...s, alerts: { ...s.alerts, ...patch } }));
  const updateAlertEmail = (patch: Partial<Settings["alerts"]["email"]>) =>
    setSettings((s) => ({
      ...s,
      alerts: { ...s.alerts, email: { ...s.alerts.email, ...patch } },
    }));

  const components = settings.components;
  const setComponent = (key: keyof Settings["components"], value: boolean) =>
    setSettings((s) => ({
      ...s,
      components: { ...s.components, [key]: value },
    }));

  // Widget visibility now lives on the layout entries themselves (the on-page
  // editor owns arrangement; these checkboxes are the same `hidden` flags).
  const layoutWidgets = settings.layout.sections;
  const isWidgetShown = (id: LayoutWidgetId) =>
    !layoutWidgets.find((w) => w.id === id)?.hidden;
  const setWidgetShown = (id: LayoutWidgetId, shown: boolean) =>
    setSettings((s) => ({
      ...s,
      layout: {
        ...s.layout,
        sections: s.layout.sections.map((w) =>
          w.id === id ? { ...w, hidden: !shown } : w
        ),
      },
    }));
  // Order mirrors roughly top-to-bottom on the page. The split
  // clock/weather/status widgets are managed in the home-page editor instead —
  // weather/status/calendar content keeps its own feature toggles.
  const widgetToggles: { id: LayoutWidgetId; label: string }[] = [
    { id: "greeting", label: "Greeting" },
    { id: "headerCard", label: "Header card (clock, weather & status)" },
    { id: "search", label: "Search bar" },
    { id: "notes", label: "Notes card" },
    { id: "countdown", label: "Countdown card" },
    { id: "apps", label: "Applications" },
    { id: "bookmarks", label: "Bookmarks" },
    { id: "favorites", label: "Favorites row" },
  ];
  const componentToggles: { key: keyof Settings["components"]; label: string }[] = [
    { key: "clock", label: "Date & clock (inside the header card)" },
    { key: "settingsButton", label: "Floating navigation menu" },
  ];
  const alertTypeLabel: Record<Settings["alerts"]["type"], string> = {
    generic: "Generic JSON webhook",
    discord: "Discord",
    slack: "Slack",
    ntfy: "ntfy",
  };
  const alertUrlPlaceholder: Record<Settings["alerts"]["type"], string> = {
    generic: "https://example.com/hook",
    discord: "https://discord.com/api/webhooks/…",
    slack: "https://hooks.slack.com/services/…",
    ntfy: "https://ntfy.sh/your-topic",
  };

  const calendar = settings.calendar;
  const updateCalendar = (patch: Partial<Settings["calendar"]>) =>
    setSettings((s) => ({ ...s, calendar: { ...s.calendar, ...patch } }));

  const notes = settings.notes;
  const updateNotes = (patch: Partial<Settings["notes"]>) =>
    setSettings((s) => ({ ...s, notes: { ...s.notes, ...patch } }));

  const announcement = settings.announcement;
  const updateAnnouncement = (patch: Partial<Settings["announcement"]>) =>
    setSettings((s) => ({
      ...s,
      announcement: { ...s.announcement, ...patch },
    }));

  const feed = settings.feed;
  const updateFeed = (patch: Partial<Settings["feed"]>) =>
    setSettings((s) => ({ ...s, feed: { ...s.feed, ...patch } }));

  const countdown = settings.countdown;
  const setCountdownItems = (items: Settings["countdown"]["items"]) =>
    setSettings((s) => ({ ...s, countdown: { ...s.countdown, items } }));
  const updateCountdownItem = (
    i: number,
    patch: Partial<Settings["countdown"]["items"][number]>
  ) =>
    setCountdownItems(
      countdown.items.map((item, idx) => (idx === i ? { ...item, ...patch } : item))
    );

  // Status-page announcements: a client-managed list saved through the whole-
  // settings autosave (each entry carries a client-minted id, like a saved
  // theme). Start/end are stored as UTC ISO instants; the datetime-local inputs
  // convert to/from the browser's local wall clock.
  const statusAnnouncements = settings.statusAnnouncements;
  const setStatusAnnouncements = (items: Settings["statusAnnouncements"]) =>
    setSettings((s) => ({ ...s, statusAnnouncements: items }));
  const updateStatusAnnouncement = (
    i: number,
    patch: Partial<Settings["statusAnnouncements"][number]>
  ) =>
    setStatusAnnouncements(
      statusAnnouncements.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    );
  const addStatusAnnouncement = () =>
    setStatusAnnouncements([
      ...statusAnnouncements,
      { id: newThemeId(), title: "", body: "", kind: "info", startsAt: "", endsAt: "" },
    ]);
  const removeStatusAnnouncement = async (i: number) => {
    const ok = await confirm({
      title: "Remove this announcement?",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setStatusAnnouncements(statusAnnouncements.filter((_, idx) => idx !== i));
  };

  const bangs = settings.search.bangs;
  const setBangs = (next: Settings["search"]["bangs"]) =>
    setSettings((s) => ({ ...s, search: { ...s.search, bangs: next } }));
  const updateBang = (i: number, patch: Partial<Settings["search"]["bangs"][number]>) =>
    setBangs(bangs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  // Apply a theme pack as the site default: record it as the preset and copy its
  // concrete design/scene/colors into the theme fields the layout actually reads.
  // This seeds BOTH modes from the one pack (dark parts + the pack's own light
  // surfaces) and clears any separate light-mode override, so light follows dark
  // unless the admin diverges it below.
  function applyDefaultTheme(name: string) {
    const pack = themePacks.find((p) => p.name === name);
    if (!pack) return;
    updateTheme({
      preset: pack.name,
      design: pack.design,
      scene: pack.scene,
      accentFrom: pack.dark.accentFrom,
      accentTo: pack.dark.accentTo,
      background: pack.dark.background,
      foreground: pack.dark.foreground,
      presetLight: undefined,
      designLight: undefined,
      sceneLight: undefined,
      backgroundLight: pack.light.background,
      foregroundLight: pack.light.foreground,
    });
  }

  // Give light mode a wholly independent look (design + scene + surfaces) from a
  // different pack. An empty name means "same as dark" — clear the override and
  // re-seed the light surfaces from the dark default's pack.
  function applyLightDefault(name: string) {
    if (!name) {
      const darkPack = themePacks.find((p) => p.name === theme.preset);
      updateTheme({
        presetLight: undefined,
        designLight: undefined,
        sceneLight: undefined,
        backgroundLight: darkPack?.light.background,
        foregroundLight: darkPack?.light.foreground,
      });
      return;
    }
    const pack = themePacks.find((p) => p.name === name);
    if (!pack) return;
    updateTheme({
      presetLight: pack.name,
      designLight: pack.design,
      sceneLight: pack.scene,
      backgroundLight: pack.light.background,
      foregroundLight: pack.light.foreground,
    });
  }

  return (
    // Settings-page shell: a nav rail (horizontal pills on small screens, a
    // sticky vertical rail on lg+) beside a content area that fills the rest of
    // the width, so any setting is one click away instead of somewhere down a
    // masonry flow.
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-x-8">
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 lg:sticky lg:top-6 lg:flex-col lg:flex-nowrap lg:self-start lg:pt-7"
      >
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${
              section === s.id
                ? "bg-fg/10 font-medium text-fg"
                : "text-fg/50 hover:bg-fg/5 hover:text-fg/80"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-3">
        {/* h-4 + gap-3 ≈ the nav's lg:pt-7, keeping rail and card tops level. */}
        <div className="flex h-4 items-center justify-end">
          <SaveStatus status={status} error={error} />
        </div>

        {/* Multi-card groups flow into two masonry columns to fill the width;
            single-card groups are centered at a comfortable reading width. */}
        <div
          className={
            MULTI_CARD_SECTIONS.includes(section)
              ? "lg:columns-2 lg:gap-4"
              : "lg:mx-auto lg:w-full lg:max-w-2xl"
          }
        >
        {section === "general" && (
        <Section title="General">
        <TextField
          label="Page title"
          value={settings.title}
          onChange={(e) => setSettings({ ...settings, title: e.target.value })}
        />
        <IconField
          label="Favicon (slug or image URL)"
          name={settings.title || "favicon"}
          value={settings.favicon}
          onChange={(favicon) => setSettings({ ...settings, favicon })}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Default time zone</span>
          <input
            list="settings-tz"
            value={settings.timezone}
            onChange={(e) =>
              setSettings({ ...settings, timezone: e.target.value })
            }
            placeholder="Search a time zone…"
            className={selectClass}
          />
          <datalist id="settings-tz">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
        </Section>
        )}

        {section === "general" && (
        <Section
          title="Appearance"
          intro={
            <>
              The site-wide default look visitors see before they customize
              their own. Pick a theme as the default; edit the themes themselves
              in the <span className="text-fg/60">Themes</span> tab.
            </>
          }
        >

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-fg/50">Default mode</span>
          <div className="flex overflow-hidden rounded-lg border border-fg/10">
            {(["system", "light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={theme.mode === m}
                onClick={() => updateTheme({ mode: m })}
                className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                  theme.mode === m
                    ? "bg-fg/15 text-fg"
                    : "text-fg/50 hover:text-fg/80"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Default theme</span>
          <select
            value={theme.preset ?? ""}
            onChange={(e) => applyDefaultTheme(e.target.value)}
            className={selectClass}
          >
            {!theme.preset && (
              <option value="" disabled>
                Custom
              </option>
            )}
            {themePacks.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Light mode look</span>
          <select
            value={theme.presetLight ?? ""}
            onChange={(e) => applyLightDefault(e.target.value)}
            className={selectClass}
          >
            <option value="">Same as default</option>
            {themePacks.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-fg/40">
            Give light mode its own design, scene &amp; colors — leave on{" "}
            <span className="text-fg/60">Same as default</span> to mirror the
            theme above.
          </span>
        </label>

        {/* Preview of the default look's dark + light surfaces with the accent. */}
        <div className="grid grid-cols-2 gap-2">
          {(["dark", "light"] as const).map((m) => {
            const bg =
              m === "light"
                ? theme.backgroundLight ?? "#eceef3"
                : theme.background ?? "#06070d";
            return (
              <div
                key={m}
                className="flex h-12 items-end justify-start overflow-hidden rounded-lg p-1.5 ring-1 ring-fg/10"
                style={{
                  background: `radial-gradient(120% 100% at 50% -10%, ${theme.accentFrom}, transparent 60%), ${bg}`,
                }}
              >
                <span className="rounded bg-black/20 px-1 text-[9px] text-white/80 capitalize">
                  {m}
                </span>
              </div>
            );
          })}
        </div>
        </Section>
        )}

        {section === "layout" && (
        <Section
          title="Visible widgets"
          intro="Show or hide home-page widgets. Weather, the status row, and the calendar are toggled in their own sections; the split clock/weather/status widgets are managed in the home-page editor."
        >
        <div className="flex flex-col gap-2.5">
          {widgetToggles.map((t) => (
            <label
              key={t.id}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="text-fg/70">{t.label}</span>
              <input
                type="checkbox"
                checked={isWidgetShown(t.id)}
                onChange={(e) => setWidgetShown(t.id, e.target.checked)}
              />
            </label>
          ))}
          {componentToggles.map((t) => (
            <label
              key={t.key}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="text-fg/70">{t.label}</span>
              <input
                type="checkbox"
                checked={components[t.key]}
                onChange={(e) => setComponent(t.key, e.target.checked)}
              />
            </label>
          ))}
        </div>
        {!components.settingsButton && (
          <p className="text-xs text-fg/40">
            With the floating navigation menu off, reach this page directly at
            /admin.
          </p>
        )}
        </Section>
        )}

        {section === "layout" && (
        <Section
          title="Arrangement"
          intro="Widgets are arranged directly on the home page: drag to reorder, resize by dragging a card's edges, and show or hide everything in place — including swapping the header card for the split clock, weather, and status widgets."
        >
          <Link
            href="/?edit=1"
            className="inline-block rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
          >
            Arrange the home page
          </Link>
        </Section>
        )}

        {section === "monitoring" && (
        <Section title="Status">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-fg/70">Service status indicators</span>
            <p className="text-xs text-fg/40">
              Show an online/offline dot on each app. The server pings every app
              URL, so leave off if your apps aren&apos;t reachable from it.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.statusChecks}
              onChange={(e) =>
                setSettings({ ...settings, statusChecks: e.target.checked })
              }
            />
            Enabled
          </label>
        </div>

        {settings.statusChecks && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-sm text-fg/70">Uptime check interval</span>
              <p className="text-xs text-fg/40">
                How often the server records each app&apos;s up/down for the
                90-day history on the status page.
              </p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-fg/10">
              {INTERVAL_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={settings.statusInterval === m}
                  onClick={() => setSettings({ ...settings, statusInterval: m })}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    settings.statusInterval === m
                      ? "bg-fg/15 text-fg"
                      : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  {m} min
                </button>
              ))}
              {/* A hand-edited config value (the schema allows 1–60) matches no
                  preset; surface it as an extra selected chip so the control
                  never reads as "nothing selected". It vanishes once a preset is
                  clicked. A span, not a button — it's a readout of the current
                  value, not a choice; making it clickable-looking-but-inert
                  would just be a keyboard trap. */}
              {!INTERVAL_PRESETS.includes(settings.statusInterval) && (
                <span className="px-3 py-1.5 text-xs bg-fg/15 text-fg">
                  {settings.statusInterval} min
                </span>
              )}
            </div>
          </div>
        )}

        {settings.statusChecks && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-sm text-fg/70">Default status range</span>
              <p className="text-xs text-fg/40">
                Which time range the status page opens on.
              </p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-fg/10">
              {STATUS_RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={settings.statusDefaultRange === r.key}
                  onClick={() =>
                    setSettings({ ...settings, statusDefaultRange: r.key })
                  }
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    settings.statusDefaultRange === r.key
                      ? "bg-fg/15 text-fg"
                      : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
        </Section>
        )}

        {section === "search" && (
        <Section title="Search engine">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg/50">Search bar engine</span>
            <select
              value={settings.search.engine}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  search: { ...settings.search, engine: e.target.value as SearchEngine },
                })
              }
              className={selectClass}
            >
              {SEARCH_ENGINE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key === "custom" ? "Custom…" : SEARCH_ENGINES[key].label}
                </option>
              ))}
            </select>
          </label>
          {settings.search.engine === "custom" && (
            <TextField
              label="Custom search URL (use %s for the query)"
              placeholder="https://example.com/search?q=%s"
              value={settings.search.customUrl}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  search: { ...settings.search, customUrl: e.target.value },
                })
              }
            />
          )}
          <p className="text-xs text-fg/40">
            Pressing Enter in the search bar opens the top match, or searches
            here when nothing matches.
          </p>
        </div>
        </Section>
        )}

        {section === "search" && (
        <Section title="Custom bangs">
        <div className="flex flex-col gap-2">
          <p className="-mt-1 text-xs text-fg/40">
            Type <span className="text-fg/60">!key term</span> in the search bar
            to jump to a site (use <span className="text-fg/60">%s</span> for the
            term). Built-ins (<span className="text-fg/60">!yt</span>,{" "}
            <span className="text-fg/60">!gh</span>,{" "}
            <span className="text-fg/60">!w</span>…) plus your app names and
            subtitles work already.
          </p>
          {bangs.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-fg/40">!</span>
              <input
                value={b.key}
                onChange={(e) =>
                  updateBang(i, {
                    key: e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase(),
                  })
                }
                placeholder="key"
                aria-label={`Bang ${i + 1} key`}
                className={`${selectClass} w-24`}
              />
              <input
                value={b.url}
                onChange={(e) => updateBang(i, { url: e.target.value })}
                placeholder="https://example.com/search?q=%s"
                aria-label={`Bang ${i + 1} URL`}
                className={`${selectClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => setBangs(bangs.filter((_, idx) => idx !== i))}
                aria-label={`Remove bang ${i + 1}`}
                className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setBangs([...bangs, { key: "", url: "" }])}
            className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
          >
            + Add bang
          </button>
        </div>
        </Section>
        )}

        {section === "monitoring" && (
        <Section title="Alerts">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-fg/70">Uptime alerts</span>
            <p className="text-xs text-fg/40">
              Notify a webhook and/or email when an app goes down or recovers.
              Requires service status indicators (the{" "}
              <span className="text-fg/60">Status</span> section) to be on.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alerts.enabled}
              onChange={(e) => updateAlerts({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        {alerts.enabled && (
          <>
            <label className="flex items-center justify-between text-sm">
              <span className="text-fg/50">Notify on recovery</span>
              <input
                type="checkbox"
                checked={alerts.notifyOnRecovery}
                onChange={(e) => updateAlerts({ notifyOnRecovery: e.target.checked })}
              />
            </label>

            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="text-fg/50">
                Confirmations before down
                <span className="block text-xs text-fg/40">
                  Consecutive failed checks required first.
                </span>
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={alerts.confirmations}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  updateAlerts({
                    confirmations: Number.isNaN(v)
                      ? alerts.confirmations
                      : Math.min(10, Math.max(1, v)),
                  });
                }}
                className={`${selectClass} w-20 text-center`}
              />
            </label>

            {/* Two independent channels, each with its own toggle — enable
                either, both, or neither. */}
            <div className="mt-1 flex flex-col gap-3 border-t border-fg/10 pt-4">
              <label className="flex items-start justify-between gap-4 text-sm">
                <span className="text-fg/50">
                  Webhook
                  <span className="block text-xs text-fg/40">
                    Post to a generic JSON endpoint, Discord, Slack, or ntfy.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={alerts.webhookEnabled}
                  onChange={(e) =>
                    updateAlerts({ webhookEnabled: e.target.checked })
                  }
                />
              </label>
              {alerts.webhookEnabled && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-fg/50">Notify via</span>
                    <select
                      value={alerts.type}
                      onChange={(e) =>
                        updateAlerts({
                          type: e.target.value as Settings["alerts"]["type"],
                        })
                      }
                      className={selectClass}
                    >
                      {ALERT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {alertTypeLabel[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextField
                    label="Webhook URL"
                    placeholder={alertUrlPlaceholder[alerts.type]}
                    value={alerts.webhookUrl}
                    onChange={(e) => updateAlerts({ webhookUrl: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-fg/10 pt-4">
              <label className="flex items-start justify-between gap-4 text-sm">
                <span className="text-fg/50">
                  Email (SMTP)
                  <span className="block text-xs text-fg/40">
                    Optional — email on down/recovery, independent of the webhook.
                    Works with any SMTP service (SMTP2GO, Gmail, Fastmail, a relay).
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={alerts.email.enabled}
                  onChange={(e) => updateAlertEmail({ enabled: e.target.checked })}
                />
              </label>

              {alerts.email.enabled && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <TextField
                        label="SMTP host"
                        placeholder="mail.smtp2go.com"
                        value={alerts.email.host}
                        onChange={(e) => updateAlertEmail({ host: e.target.value })}
                      />
                    </div>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-fg/50">Port</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={alerts.email.port}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          updateAlertEmail({
                            port: Number.isNaN(v)
                              ? alerts.email.port
                              : Math.min(65535, Math.max(1, v)),
                          });
                        }}
                        className={selectClass}
                      />
                    </label>
                  </div>

                  <label className="flex items-center justify-between text-sm">
                    <span className="text-fg/50">
                      Implicit TLS (port 465)
                      <span className="block text-xs text-fg/40">
                        Leave off for 587/STARTTLS.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={alerts.email.secure}
                      onChange={(e) => updateAlertEmail({ secure: e.target.checked })}
                    />
                  </label>

                  <TextField
                    label="Username"
                    autoComplete="off"
                    value={alerts.email.user}
                    onChange={(e) => updateAlertEmail({ user: e.target.value })}
                  />
                  <div>
                    <TextField
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      value={alerts.email.pass}
                      onChange={(e) => updateAlertEmail({ pass: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-fg/40">
                      Stored in config.yaml. Set the CTRLCENTER_SMTP_PASS env var
                      to keep it out of the file instead.
                    </p>
                  </div>
                  <TextField
                    label="From address"
                    placeholder="ctrlcenter@yourdomain.com"
                    value={alerts.email.from}
                    onChange={(e) => updateAlertEmail({ from: e.target.value })}
                  />
                  <TextField
                    label="To address"
                    placeholder="you@example.com"
                    value={alerts.email.to}
                    onChange={(e) => updateAlertEmail({ to: e.target.value })}
                  />
                  <div>
                    <TextField
                      label="Subject"
                      placeholder="{service} is {status}"
                      value={alerts.email.subject}
                      onChange={(e) =>
                        updateAlertEmail({ subject: e.target.value })
                      }
                    />
                    <p className="mt-1 text-xs text-fg/40">
                      Variables: <code>{"{service}"}</code> and{" "}
                      <code>{"{status}"}</code> (down/up). Blank uses the default.
                    </p>
                  </div>
                  {!(
                    alerts.email.host.trim() &&
                    alerts.email.from.trim() &&
                    alerts.email.to.trim()
                  ) && (
                    <p className="text-xs text-amber-400/80">
                      Add an SMTP host and from/to addresses to start sending —
                      email stays off until then.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-fg/10 pt-4">
              <AlertTest
                webhookConfigured={
                  alerts.webhookEnabled && alerts.webhookUrl.trim() !== ""
                }
                emailConfigured={
                  alerts.email.enabled &&
                  alerts.email.host.trim() !== "" &&
                  alerts.email.from.trim() !== "" &&
                  alerts.email.to.trim() !== ""
                }
              />
            </div>
          </>
        )}
        </Section>
        )}

        {section === "monitoring" && (
        <Section
          title="Announcements"
          intro="Maintenance windows and upcoming changes, posted on the status page. An entry with a start time in the future shows as scheduled; once its end time passes it stops showing. Independent of the status checks above — a notice appears even with checks off."
        >
        <div className="flex flex-col gap-3">
          {statusAnnouncements.length === 0 && (
            <p className="-mt-1 text-xs text-fg/40">
              No announcements yet. Add one to post a maintenance window or
              notice on the status page.
            </p>
          )}
          {statusAnnouncements.map((a, i) => {
            const state = announcementState(a, now);
            return (
              <div
                key={a.id}
                className="flex flex-col gap-3 rounded-xl border border-fg/10 bg-fg/[0.03] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-fg/60">
                      Announcement {i + 1}
                    </span>
                    <span className="rounded-full bg-fg/10 px-2 py-0.5 text-[0.7rem] font-medium text-fg/60">
                      {STATUS_STATE_LABELS[state]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStatusAnnouncement(i)}
                    aria-label={`Remove announcement ${i + 1}`}
                    className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>

                <TextField
                  label="Title"
                  value={a.title}
                  onChange={(e) =>
                    updateStatusAnnouncement(i, { title: e.target.value })
                  }
                />

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-fg/50">Message</span>
                  <textarea
                    value={a.body}
                    onChange={(e) =>
                      updateStatusAnnouncement(i, { body: e.target.value })
                    }
                    rows={2}
                    placeholder={"Upgrading the NAS 10–11pm — some services may blip. [details](https://…)"}
                    className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm leading-relaxed text-fg placeholder-fg/30 outline-none transition-colors"
                  />
                  <span className="text-xs text-fg/40">
                    Supports inline **bold**, *italic*, `code` and
                    [links](https://…) (http/https only). Raw HTML is shown as
                    plain text.
                  </span>
                </label>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-fg/50">Kind</span>
                  <div className="flex overflow-hidden rounded-lg border border-fg/10 text-xs">
                    {STATUS_ANNOUNCEMENT_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={a.kind === k}
                        onClick={() => updateStatusAnnouncement(i, { kind: k })}
                        className={`flex-1 px-2 py-1.5 transition-colors ${
                          a.kind === k
                            ? "bg-fg/15 text-fg"
                            : "text-fg/50 hover:text-fg/80"
                        }`}
                      >
                        {STATUS_KIND_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-fg/50">Starts (optional)</span>
                    <input
                      type="datetime-local"
                      value={isoToLocalInput(a.startsAt)}
                      onChange={(e) =>
                        updateStatusAnnouncement(i, {
                          startsAt: localInputToIso(e.target.value),
                        })
                      }
                      className={selectClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-fg/50">Ends (optional)</span>
                    <input
                      type="datetime-local"
                      value={isoToLocalInput(a.endsAt)}
                      onChange={(e) =>
                        updateStatusAnnouncement(i, {
                          endsAt: localInputToIso(e.target.value),
                        })
                      }
                      className={selectClass}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addStatusAnnouncement}
            className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
          >
            + Add announcement
          </button>
        </div>
        <p className="text-xs text-fg/40">
          Leave both times empty to show a notice until you remove it. Times use
          this browser&apos;s time zone; visitors see them in their own.
        </p>
        </Section>
        )}

        {section === "weather" && (
        <Section title="Weather">
        <label className="flex items-center justify-between text-sm">
          <span className="text-fg/50">Weather widget</span>
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.weather.enabled}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  weather: { ...settings.weather, enabled: e.target.checked },
                })
              }
            />
            Enabled
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-fg/50">Default location</span>
          <CitySearch
            onSelect={(latitude, longitude) =>
              setSettings({
                ...settings,
                weather: { ...settings.weather, latitude, longitude },
              })
            }
          />
          <p className="text-xs text-fg/40">
            Search a city to set the coordinates, or enter them manually.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            value={settings.weather.latitude}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setSettings({
                ...settings,
                weather: {
                  ...settings.weather,
                  latitude: Number.isNaN(v) ? settings.weather.latitude : v,
                },
              });
            }}
          />
          <TextField
            label="Longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            value={settings.weather.longitude}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setSettings({
                ...settings,
                weather: {
                  ...settings.weather,
                  longitude: Number.isNaN(v) ? settings.weather.longitude : v,
                },
              });
            }}
          />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Units</span>
          <select
            value={settings.weather.units}
            onChange={(e) =>
              setSettings({
                ...settings,
                weather: {
                  ...settings.weather,
                  units: e.target.value as "imperial" | "metric",
                },
              })
            }
            className={selectClass}
          >
            <option value="imperial">Imperial (°F)</option>
            <option value="metric">Metric (°C)</option>
          </select>
        </label>
        </Section>
        )}

        {section === "widgets" && (
        <Section title="Calendar">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-fg/70">Agenda widget</span>
            <p className="text-xs text-fg/40">
              Show upcoming events from a published iCal (.ics) URL — or a private
              CalDAV/WebDAV calendar (e.g. a Nextcloud DAV URL) with credentials.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={calendar.enabled}
              onChange={(e) => updateCalendar({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        {calendar.enabled && (
          <>
            <TextField
              label="Calendar URL (.ics or CalDAV/WebDAV)"
              placeholder="https://calendar.google.com/…/basic.ics"
              value={calendar.url}
              onChange={(e) => updateCalendar({ url: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Username (optional)"
                autoComplete="off"
                value={calendar.username}
                onChange={(e) => updateCalendar({ username: e.target.value })}
              />
              <TextField
                label="Password (optional)"
                type="password"
                autoComplete="new-password"
                value={calendar.password}
                onChange={(e) => updateCalendar({ password: e.target.value })}
              />
            </div>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="text-fg/50">
                Home widget view
                <span className="block text-xs text-fg/40">
                  Agenda lists upcoming events; Month shows a mini calendar that
                  links through. The /calendar page always opens on the month view.
                </span>
              </span>
              <select
                value={calendar.homeView}
                onChange={(e) =>
                  updateCalendar({
                    homeView: e.target.value as "agenda" | "month",
                  })
                }
                className={`${selectClass} shrink-0`}
              >
                <option value="agenda">Agenda</option>
                <option value="month">Month</option>
              </select>
            </label>
            {calendar.homeView === "agenda" && (
              <label className="flex items-center justify-between gap-4 text-sm">
                <span className="text-fg/50">Events to show</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={calendar.count}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    updateCalendar({
                      count: Number.isNaN(v) ? calendar.count : Math.min(20, Math.max(1, v)),
                    });
                  }}
                  className={`${selectClass} w-20 text-center`}
                />
              </label>
            )}
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="text-fg/50">
                Hide when no upcoming events
                <span className="block text-xs text-fg/40">
                  Drop the home-page card when the agenda is empty. The{" "}
                  /calendar page is unaffected.
                </span>
              </span>
              <input
                type="checkbox"
                className="shrink-0"
                checked={calendar.hideWhenEmpty}
                onChange={(e) =>
                  updateCalendar({ hideWhenEmpty: e.target.checked })
                }
              />
            </label>
            <CalendarTest
              url={calendar.url}
              username={calendar.username}
              password={calendar.password}
            />
            {calendar.username.trim() !== "" &&
              /^http:\/\//i.test(calendar.url.trim()) && (
                <p className="text-xs text-amber-400/80">
                  This URL is plain http, so the credentials are sent in
                  cleartext. Use https where possible.
                </p>
              )}
            <p className="text-xs text-fg/40">
              For a private calendar, paste its CalDAV/WebDAV collection URL and
              credentials (a Nextcloud app password is recommended); the events are
              fetched server-side. The password can instead come from the
              CTRLCENTER_CALDAV_PASS env var. Times show in each visitor&apos;s
              time zone; repeating events expand for common rules
              (daily/weekly/monthly).
            </p>
          </>
        )}
        </Section>
        )}

        {section === "widgets" && (
        <Section title="RSS feed">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-fg/70">Feed widget</span>
            <p className="text-xs text-fg/40">
              Show the latest entries from an RSS or Atom feed. Fetched
              server-side and cached for a few minutes. Ships hidden — show the
              card in the home-page layout editor once configured.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={feed.enabled}
              onChange={(e) => updateFeed({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        {feed.enabled && (
          <>
            <TextField
              label="Feed URL (RSS or Atom)"
              placeholder="https://example.com/feed.xml"
              value={feed.url}
              onChange={(e) => updateFeed({ url: e.target.value })}
            />
            <TextField
              label="Card title (optional — defaults to the feed's own)"
              placeholder=""
              value={feed.title}
              onChange={(e) => updateFeed({ title: e.target.value })}
            />
            <label className="flex items-center justify-between gap-4 text-sm">
              <span className="text-fg/50">Entries to show</span>
              <input
                type="number"
                min={1}
                max={15}
                value={feed.count}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  updateFeed({
                    count: Number.isNaN(v)
                      ? feed.count
                      : Math.min(15, Math.max(1, v)),
                  });
                }}
                className={`${selectClass} w-20 text-center`}
              />
            </label>
            <FeedTest url={feed.url} />
          </>
        )}
        </Section>
        )}

        {section === "widgets" && (
        <Section
          title="Notes"
          intro="A free-form note card for the home page. Ships hidden — show it in the home-page layout editor (or the Layout section above) once there's something to say."
        >
          <TextField
            label="Card title"
            placeholder="Notes"
            value={notes.title}
            onChange={(e) => updateNotes({ title: e.target.value })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg/50">Note (markdown)</span>
            <textarea
              value={notes.content}
              onChange={(e) => updateNotes({ content: e.target.value })}
              rows={10}
              placeholder={"# Homelab\n- Renew certs **June 12**\n- `docker compose pull` after backups"}
              className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 font-mono text-xs leading-relaxed text-fg placeholder-fg/30 outline-none transition-colors"
            />
          </label>
          <p className="text-xs text-fg/40">
            Supports a safe markdown subset: # ## ### headings, **bold**,
            *italic*, `code`, [links](https://…) (http/https only), - and 1.
            lists, &gt; quotes, ``` code blocks and --- rules. Raw HTML is shown
            as plain text, never rendered.
          </p>
        </Section>
        )}

        {section === "announcement" && (
        <Section
          title="Announcement"
          intro="A banner across the top of every page — maintenance windows, notices, a heads-up for the household. Turn it on, write the message, and it shows site-wide until you turn it off."
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-sm text-fg/70">Show the banner</span>
              <p className="text-xs text-fg/40">
                Appears at the top of every page while enabled.
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={announcement.enabled}
                onChange={(e) =>
                  updateAnnouncement({ enabled: e.target.checked })
                }
              />
              Enabled
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg/50">Message</span>
            <textarea
              value={announcement.message}
              onChange={(e) => updateAnnouncement({ message: e.target.value })}
              rows={3}
              placeholder={"**Maintenance tonight** 10–11pm — [status](https://…)"}
              className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm leading-relaxed text-fg placeholder-fg/30 outline-none transition-colors"
            />
          </label>
          <p className="text-xs text-fg/40">
            Supports inline **bold**, *italic*, `code` and [links](https://…)
            (http/https only). Raw HTML is shown as plain text, never rendered.
          </p>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg/50">Tone</span>
            <select
              value={announcement.tone}
              onChange={(e) =>
                updateAnnouncement({
                  tone: e.target.value as Settings["announcement"]["tone"],
                })
              }
              className={selectClass}
            >
              {ANNOUNCEMENT_TONES.map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4 text-sm">
            <div>
              <span className="text-fg/70">Dismissible</span>
              <p className="text-xs text-fg/40">
                Let visitors close it; it returns if you change the message.
              </p>
            </div>
            <input
              type="checkbox"
              checked={announcement.dismissible}
              onChange={(e) =>
                updateAnnouncement({ dismissible: e.target.checked })
              }
            />
          </label>
        </Section>
        )}

        {section === "widgets" && (
        <Section
          title="Countdown"
          intro="Labeled dates shown as “in N days” rows — renewals, birthdays, deadlines. Ships hidden — show the card in the home-page layout editor once dates are added."
        >
          <TextField
            label="Card title"
            placeholder="Countdown"
            value={countdown.title}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                countdown: { ...s.countdown, title: e.target.value },
              }))
            }
          />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg/50">Dates</span>
            {countdown.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={item.label}
                  onChange={(e) => updateCountdownItem(i, { label: e.target.value })}
                  placeholder="Renew domain"
                  aria-label={`Countdown ${i + 1} label`}
                  className={`${selectClass} min-w-0 flex-1`}
                />
                <input
                  type="date"
                  value={item.date}
                  onChange={(e) => updateCountdownItem(i, { date: e.target.value })}
                  aria-label={`Countdown ${i + 1} date`}
                  className={`${selectClass} shrink-0`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setCountdownItems(countdown.items.filter((_, idx) => idx !== i))
                  }
                  aria-label={`Remove countdown ${i + 1}`}
                  className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setCountdownItems([...countdown.items, { label: "", date: "" }])
              }
              className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
            >
              + Add date
            </button>
          </div>
          <p className="text-xs text-fg/40">
            Days count in each visitor&apos;s own time zone. Past dates dim and
            sink below the upcoming ones.
          </p>
        </Section>
        )}

        {section === "security" && (
        <Section
          title="Security"
          intro="The password used to sign in to this admin portal."
        >
          <ChangePassword />
        </Section>
        )}
        </div>
      </div>
    </div>
  );
}
