"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Settings } from "@/lib/schema";
import {
  ALERT_TYPES,
  ANNOUNCEMENT_TONES,
  STATUS_ANNOUNCEMENT_KINDS,
  feedUrls,
  MAX_FEED_URLS,
  MAX_STAT_DISKS,
} from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import { FONTS, fontVar, type FontId } from "@/lib/fonts";
import {
  SEARCH_ENGINES,
  SEARCH_ENGINE_KEYS,
  type SearchEngine,
} from "@/lib/search";
import { STATUS_RANGES } from "@/lib/status";
import {
  STATUS_ANNOUNCEMENT_KIND_META,
  announcementState,
} from "@/lib/status-announcements";
import { useNow } from "../useNow";
import { supportedTimezones, newThemeId } from "@/lib/prefs";
import { resolveLayoutWidgets, type LayoutWidgetId } from "@/lib/layout";
import { TextField, MoveButtons } from "./ui";
import { ChipGroup } from "@/components/ChipGroup";
import { reorder } from "./useReorder";
import IconField from "./IconField";
import CalendarTest from "./CalendarTest";
import FeedTest from "./FeedTest";
import AlertTest from "./AlertTest";
import CitySearch from "./CitySearch";
import ChangePassword from "./ChangePassword";
import { useConfirm } from "./Confirm";
import { replaceUrlParams } from "./urlState";
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

// One nav entry per settings group; a single group shows at a time. The rail
// stays short by grouping under one rule: everything that configures a
// home-page widget lives under Widgets — the search bar, weather, calendar,
// feed, notes, countdown, and the status row together with its alerts and
// status-page announcements. Appearance folds into General; the site-wide
// Announcement banner and Security stand on their own.
const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "layout", label: "Home layout" },
  { id: "widgets", label: "Widgets" },
  { id: "announcement", label: "Announcement" },
  { id: "security", label: "Security" },
] as const;
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

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

// Stable React keys for editable rows whose stored shape has no id (custom
// bangs, countdown dates — the persisted schema stays id-free on purpose).
// Index keys mis-attach focus/IME state when a middle row is removed, so add
// and removeAt update the items and their keys in one call — the pairing
// can't be forgotten at a call site. In-place edits keep row identity. Keys
// come from newThemeId(), not crypto.randomUUID directly: plain-HTTP LAN
// hosting is a non-secure context, where randomUUID doesn't exist.
//
// `setItems` takes an UPDATER, not a concrete array, and add/removeAt/move
// compose off `prev` rather than the render-captured `items`. React batches
// several mutations that land in one tick (clicking "+ Add" a few times faster
// than a repaint to line up rows), and a snapshot-based add would then compute
// every new array from the same pre-batch list — so all but the last collapse
// and rows silently vanish. The updater form composes each mutation on the
// latest state, and keeps the parallel `keys` in lockstep. `items` is still
// read for `move`'s bounds check (a discrete click, never batched).
function useKeyedRows<T>(
  items: T[],
  setItems: (update: (prev: T[]) => T[]) => void
) {
  const [keys, setKeys] = useState<string[]>(() =>
    Array.from({ length: items.length }, () => newThemeId())
  );
  return {
    keys,
    add: (item: T) => {
      setItems((prev) => [...prev, item]);
      setKeys((k) => [...k, newThemeId()]);
    },
    removeAt: (i: number) => {
      setItems((prev) => prev.filter((_, idx) => idx !== i));
      setKeys((k) => k.filter((_, idx) => idx !== i));
    },
    // Reorder items and their keys together so a moved row keeps its identity
    // (focus/IME) instead of the value sliding under a stale key.
    move: (from: number, to: number) => {
      if (from === to || to < 0 || to >= items.length) return;
      setItems((prev) => reorder(prev, from, to));
      setKeys((k) => reorder(k, from, to));
    },
  };
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
  // A stable, title-derived anchor so a card can be deep-linked
  // (e.g. #settings-card-alerts).
  const id =
    "settings-card-" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  return (
    // break-inside-avoid: the settings groups flow into CSS columns at wide
    // widths (see the content wrapper below), and a card must never be split
    // across a column break.
    <section
      id={id}
      className="glass-card mb-4 flex break-inside-avoid flex-col gap-4 p-5"
    >
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
  initialSection,
}: {
  initialSettings: Settings;
  themePacks: ThemePack[];
  // The ?section deep-link param, read server-side by /admin's page (see
  // AdminDashboard's matching prop for why useSearchParams is avoided).
  initialSection?: string;
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
    // Fold the deprecated single feed `url` into the `urls` list up front, so a
    // pre-1.9.6 config shows its feed in the editor and autosaves the new shape.
    feed: {
      ...initialSettings.feed,
      urls: feedUrls(initialSettings.feed),
    },
  }));
  // The URL seeds the active section (?tab=settings&section=widgets is a
  // shareable deep link that survives refresh); rail clicks mirror it back
  // with a history replace. AdminDashboard owns the `tab` param the same way.
  const [section, setSection] = useState<SettingsSectionId>(() =>
    SETTINGS_SECTIONS.some((s) => s.id === initialSection)
      ? (initialSection as SettingsSectionId)
      : "general"
  );

  function selectSection(next: SettingsSectionId) {
    setSection(next);
    replaceUrlParams((params) => params.set("section", next));
  }

  // Honor a #settings-card-… hash once on mount (the anchors each card
  // carries), so a link can point at one card inside a long section.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#settings-card-")) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, []);
  // A ticking clock so each announcement's derived state chip (Active /
  // Scheduled / Expired) stays current without a reload.
  const now = useNow(30_000);
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
    { id: "worldClocks", label: "World clocks card" },
    { id: "systemStats", label: "System stats card" },
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

  // Every list editor below threads a FUNCTIONAL updater through setSettings
  // (update off the latest sub-array, never a render-captured snapshot), so a
  // batched pair of row mutations can't drop data — see useKeyedRows.
  const feed = settings.feed;
  const updateFeed = (patch: Partial<Settings["feed"]>) =>
    setSettings((s) => ({ ...s, feed: { ...s.feed, ...patch } }));
  const setFeedUrls = (update: (prev: string[]) => string[]) =>
    setSettings((s) => ({ ...s, feed: { ...s.feed, urls: update(s.feed.urls) } }));
  const feedUrlRows = useKeyedRows(feed.urls, setFeedUrls);
  const updateFeedUrl = (i: number, url: string) =>
    setFeedUrls((urls) => urls.map((u, idx) => (idx === i ? url : u)));

  const countdown = settings.countdown;
  const setCountdownItems = (
    update: (prev: Settings["countdown"]["items"]) => Settings["countdown"]["items"]
  ) =>
    setSettings((s) => ({
      ...s,
      countdown: { ...s.countdown, items: update(s.countdown.items) },
    }));
  const countdownRows = useKeyedRows(countdown.items, setCountdownItems);
  const updateCountdownItem = (
    i: number,
    patch: Partial<Settings["countdown"]["items"][number]>
  ) =>
    setCountdownItems((items) =>
      items.map((item, idx) => (idx === i ? { ...item, ...patch } : item))
    );

  const worldClocks = settings.worldClocks;
  const setWorldClockItems = (
    update: (prev: Settings["worldClocks"]["items"]) => Settings["worldClocks"]["items"]
  ) =>
    setSettings((s) => ({
      ...s,
      worldClocks: { ...s.worldClocks, items: update(s.worldClocks.items) },
    }));
  const worldClockRows = useKeyedRows(worldClocks.items, setWorldClockItems);
  const updateWorldClockItem = (
    i: number,
    patch: Partial<Settings["worldClocks"]["items"][number]>
  ) =>
    setWorldClockItems((items) =>
      items.map((item, idx) => (idx === i ? { ...item, ...patch } : item))
    );

  const systemStats = settings.systemStats;
  const setStatDisks = (
    update: (prev: Settings["systemStats"]["disks"]) => Settings["systemStats"]["disks"]
  ) =>
    setSettings((s) => ({
      ...s,
      systemStats: { ...s.systemStats, disks: update(s.systemStats.disks) },
    }));
  const statDiskRows = useKeyedRows(systemStats.disks, setStatDisks);
  const updateStatDisk = (
    i: number,
    patch: Partial<Settings["systemStats"]["disks"][number]>
  ) =>
    setStatDisks((disks) =>
      disks.map((d, idx) => (idx === i ? { ...d, ...patch } : d))
    );

  // Status-page announcements: a client-managed list saved through the whole-
  // settings autosave (each entry carries a client-minted id, like a saved
  // theme). Start/end are stored as UTC ISO instants; the datetime-local inputs
  // convert to/from the browser's local wall clock.
  const statusAnnouncements = settings.statusAnnouncements;
  const setStatusAnnouncements = (
    update: (prev: Settings["statusAnnouncements"]) => Settings["statusAnnouncements"]
  ) =>
    setSettings((s) => ({
      ...s,
      statusAnnouncements: update(s.statusAnnouncements),
    }));
  const updateStatusAnnouncement = (
    i: number,
    patch: Partial<Settings["statusAnnouncements"][number]>
  ) =>
    setStatusAnnouncements((items) =>
      items.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    );
  const addStatusAnnouncement = () =>
    setStatusAnnouncements((items) => [
      ...items,
      { id: newThemeId(), title: "", body: "", kind: "info", startsAt: "", endsAt: "" },
    ]);
  const removeStatusAnnouncement = async (i: number) => {
    const ok = await confirm({
      title: "Remove this announcement?",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setStatusAnnouncements((items) => items.filter((_, idx) => idx !== i));
  };

  const bangs = settings.search.bangs;
  const setBangs = (
    update: (prev: Settings["search"]["bangs"]) => Settings["search"]["bangs"]
  ) =>
    setSettings((s) => ({ ...s, search: { ...s.search, bangs: update(s.search.bangs) } }));
  const bangRows = useKeyedRows(bangs, setBangs);
  const updateBang = (i: number, patch: Partial<Settings["search"]["bangs"][number]>) =>
    setBangs((list) => list.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  // Apply a theme pack as the site default: record it as the preset and copy its
  // concrete design/scene/colors into the theme fields the layout actually reads.
  // This seeds BOTH modes from the one pack (dark parts + the pack's own light
  // surfaces) and clears any separate light-mode override, so light follows dark
  // unless the admin diverges it below. The light accent pair (only ever set by
  // promoting a saved theme, #142) is cleared for the same reason.
  function applyDefaultTheme(name: string) {
    const pack = themePacks.find((p) => p.name === name);
    if (!pack) return;
    updateTheme({
      preset: pack.name,
      design: pack.design,
      scene: pack.scene,
      accentFrom: pack.dark.accentFrom,
      accentTo: pack.dark.accentTo,
      accentFromLight: undefined,
      accentToLight: undefined,
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
        accentFromLight: undefined,
        accentToLight: undefined,
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
      accentFromLight: undefined,
      accentToLight: undefined,
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
            onClick={() => selectSection(s.id)}
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

        {/* The group's cards use the whole content cell (#161): one column at
            a comfortable width normally, flowing into two side-by-side columns
            once the cell is wide enough that each column still gets ~500px+
            (container query, so the split follows the actual cell, not the
            viewport). Card order within a group is meaningful — CSS columns
            keep it, reading down the first column then the second. */}
        <div className="@container">
        <div className="gap-4 @5xl:columns-2">
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
          <ChipGroup
            label="Default mode"
            capitalize
            options={(["system", "light", "dark"] as const).map((m) => ({
              value: m,
              label: m,
            }))}
            value={theme.mode}
            onChange={(mode) => updateTheme({ mode })}
          />
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

        {/* Theme packs deliberately don't carry a font, so the default font is
            its own control rather than part of the pack selects above. Each
            option renders in its own face (every font is loaded up front in the
            root layout, so the variables exist here too). */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Default font</span>
          <select
            value={theme.font}
            onChange={(e) => updateTheme({ font: e.target.value as FontId })}
            className={selectClass}
            style={{ fontFamily: fontVar(theme.font) }}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Light mode font</span>
          <select
            value={theme.fontLight ?? ""}
            onChange={(e) =>
              updateTheme({
                fontLight: (e.target.value || undefined) as FontId | undefined,
              })
            }
            className={selectClass}
            style={
              theme.fontLight
                ? { fontFamily: fontVar(theme.fontLight) }
                : undefined
            }
          >
            <option value="">Same as default</option>
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
                {f.name}
              </option>
            ))}
          </select>
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
          intro="Show or hide home-page widgets. Weather, the status row, and the calendar are toggled in the Widgets section; the split clock/weather/status widgets are managed in the home-page editor."
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

        {section === "widgets" && (
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

        {section === "widgets" && (
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
            <div key={bangRows.keys[i] ?? i} className="flex items-center gap-2">
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
                onClick={() => bangRows.removeAt(i)}
                aria-label={`Remove bang ${i + 1}`}
                className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => bangRows.add({ key: "", url: "" })}
            className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
          >
            + Add bang
          </button>
        </div>
        </Section>
        )}

        {section === "widgets" && (
        <Section title="Weather">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-fg/70">Weather widget</span>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
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
          </label>
        </div>

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
              Show the latest entries from one or more RSS or Atom feeds, merged
              newest-first. Fetched server-side and cached for a few minutes.
              Ships hidden — show the card in the home-page layout editor once
              configured.
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
            <div className="flex flex-col gap-2">
              <span className="text-sm text-fg/50">Feed URLs (RSS or Atom)</span>
              {feed.urls.map((url, i) => (
                <div
                  key={feedUrlRows.keys[i] ?? i}
                  className="flex flex-col gap-1.5"
                >
                  <div className="flex items-center gap-2">
                    {feed.urls.length > 1 && (
                      <MoveButtons
                        index={i}
                        count={feed.urls.length}
                        label={`feed ${i + 1}`}
                        onMove={feedUrlRows.move}
                      />
                    )}
                    <input
                      value={url}
                      onChange={(e) => updateFeedUrl(i, e.target.value)}
                      placeholder="https://example.com/feed.xml"
                      aria-label={`Feed ${i + 1} URL`}
                      className={`${selectClass} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => feedUrlRows.removeAt(i)}
                      aria-label={`Remove feed ${i + 1}`}
                      className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                  {url.trim() !== "" && <FeedTest url={url} />}
                </div>
              ))}
              {feed.urls.length < MAX_FEED_URLS && (
                <button
                  type="button"
                  onClick={() => feedUrlRows.add("")}
                  className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
                >
                  + Add feed
                </button>
              )}
            </div>
            <TextField
              label="Card title (optional — defaults to the first feed's own)"
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
            <p className="text-xs text-fg/40">
              With several feeds, each entry shows its source. The count caps the
              combined list.
            </p>
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
              <div
                key={countdownRows.keys[i] ?? i}
                className="flex items-center gap-2"
              >
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
                  onClick={() => countdownRows.removeAt(i)}
                  aria-label={`Remove countdown ${i + 1}`}
                  className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => countdownRows.add({ label: "", date: "" })}
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

        {section === "widgets" && (
        <Section
          title="World clocks"
          intro="Live clocks for the time zones you follow. Ships hidden — show the card in the home-page layout editor once zones are added."
        >
          <TextField
            label="Card title"
            placeholder="World clocks"
            value={worldClocks.title}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                worldClocks: { ...s.worldClocks, title: e.target.value },
              }))
            }
          />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg/50">Time zones</span>
            {worldClocks.items.map((item, i) => (
              <div
                key={worldClockRows.keys[i] ?? i}
                className="flex items-center gap-2"
              >
                {worldClocks.items.length > 1 && (
                  <MoveButtons
                    index={i}
                    count={worldClocks.items.length}
                    label={`world clock ${i + 1}`}
                    onMove={worldClockRows.move}
                  />
                )}
                <input
                  value={item.label}
                  onChange={(e) => updateWorldClockItem(i, { label: e.target.value })}
                  placeholder="Label (optional)"
                  aria-label={`World clock ${i + 1} label`}
                  className={`${selectClass} min-w-0 flex-1`}
                />
                <input
                  list="settings-tz"
                  value={item.timeZone}
                  onChange={(e) => updateWorldClockItem(i, { timeZone: e.target.value })}
                  placeholder="Time zone…"
                  aria-label={`World clock ${i + 1} time zone`}
                  className={`${selectClass} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => worldClockRows.removeAt(i)}
                  aria-label={`Remove world clock ${i + 1}`}
                  className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => worldClockRows.add({ label: "", timeZone: "" })}
              className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
            >
              + Add time zone
            </button>
          </div>
          <p className="text-xs text-fg/40">
            Each clock shows the current time in its own zone. Leave the label
            blank to use the zone&apos;s city name.
          </p>
        </Section>
        )}

        {section === "widgets" && (
        <Section
          title="System stats"
          intro="CPU, memory and disk usage of whatever runs the app. Ships hidden — show the card in the home-page layout editor. The card itself says whether it's measuring this container or the host machine."
        >
          <TextField
            label="Card title"
            placeholder="System stats"
            value={systemStats.title}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                systemStats: { ...s.systemStats, title: e.target.value },
              }))
            }
          />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg/50">Extra disks</span>
            {systemStats.disks.map((disk, i) => (
              <div
                key={statDiskRows.keys[i] ?? i}
                className="flex items-center gap-2"
              >
                {systemStats.disks.length > 1 && (
                  <MoveButtons
                    index={i}
                    count={systemStats.disks.length}
                    label={`disk ${i + 1}`}
                    onMove={statDiskRows.move}
                  />
                )}
                <input
                  value={disk.label}
                  onChange={(e) => updateStatDisk(i, { label: e.target.value })}
                  placeholder="Label (optional)"
                  aria-label={`Disk ${i + 1} label`}
                  className={`${selectClass} min-w-0 flex-1`}
                />
                <input
                  value={disk.path}
                  onChange={(e) => updateStatDisk(i, { path: e.target.value })}
                  placeholder="/mnt/media"
                  aria-label={`Disk ${i + 1} path`}
                  className={`${selectClass} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => statDiskRows.removeAt(i)}
                  aria-label={`Remove disk ${i + 1}`}
                  className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
            {systemStats.disks.length < MAX_STAT_DISKS && (
              <button
                type="button"
                onClick={() => statDiskRows.add({ label: "", path: "" })}
                className="self-start rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
              >
                + Add disk
              </button>
            )}
          </div>
          <p className="text-xs text-fg/40">
            The data volume is always shown. A path here has to be mounted into
            the app&apos;s container to be measurable; a path that isn&apos;t is
            simply skipped.
          </p>
        </Section>
        )}

        {section === "widgets" && (
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
            {/* A hand-edited config value (the schema allows 1–60) matches no
                preset; `offLabel` surfaces it as a read-only chip so the control
                never reads as "nothing selected". */}
            <ChipGroup
              label="Uptime check interval"
              shrink
              options={INTERVAL_PRESETS.map((m) => ({
                value: m,
                label: `${m} min`,
              }))}
              value={settings.statusInterval}
              onChange={(m) => setSettings({ ...settings, statusInterval: m })}
              offLabel={(m) => `${m} min`}
            />
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
            <ChipGroup
              label="Default status range"
              shrink
              options={STATUS_RANGES.map((r) => ({
                value: r.key,
                label: r.label,
              }))}
              value={settings.statusDefaultRange}
              onChange={(r) =>
                setSettings({ ...settings, statusDefaultRange: r })
              }
            />
          </div>
        )}
        </Section>
        )}

        {section === "widgets" && (
        <Section title="Alerts">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-fg/70">Uptime alerts</span>
            <p className="text-xs text-fg/40">
              Notify a webhook and/or email when an app goes down or recovers.
              Requires service status indicators (the{" "}
              <span className="text-fg/60">Status</span> card) to be on.
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

        {section === "widgets" && (
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
                  <ChipGroup
                    label="Announcement kind"
                    equal
                    options={STATUS_ANNOUNCEMENT_KINDS.map((k) => ({
                      value: k,
                      label: STATUS_ANNOUNCEMENT_KIND_META[k].label,
                    }))}
                    value={a.kind}
                    onChange={(kind) => updateStatusAnnouncement(i, { kind })}
                  />
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
    </div>
  );
}
