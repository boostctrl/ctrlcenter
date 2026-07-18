"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Settings, FeedConfig } from "@/lib/schema";
import {
  ALERT_TYPES,
  ANNOUNCEMENT_TONES,
  STATUS_ANNOUNCEMENT_KINDS,
  feedUrls,
  MAX_FEED_URLS,
  MAX_FEED_CARDS,
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
import { buttonClasses } from "@/lib/buttons";
import {
  AddButton,
  Card,
  ControlRow,
  Hint,
  ListPanel,
  MoveButtons,
  NumberField,
  NumberRow,
  RemoveButton,
  SelectField,
  Switch,
  TextArea,
  TextField,
  ToggleRow,
  controlClasses,
  fieldLabelClasses,
  subCardClasses,
} from "./ui";
import { ChipGroup } from "@/components/ChipGroup";
import { reorder } from "./useReorder";
import IconField from "./IconField";
import CalendarTest from "./CalendarTest";
import FeedTest from "./FeedTest";
import { FeedHealthBadge, useFeedHealth } from "./FeedHealth";
import type { FeedHealth } from "@/lib/feed";
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

// One nav entry per settings group; a single group shows at a time. The
// grouping rule (#180), ordered identity → layout → content → operations →
// communication → account: General is the site's identity and default look;
// Home layout is which widgets show and how they're arranged; a card lives
// under Widgets iff it configures what a home-page widget SHOWS; Monitoring
// is the uptime infrastructure — status checks and their alerts are a
// service, not widget content; Announcements gathers the two "tell visitors
// something" surfaces (the site-wide banner and the status page's notices).
// The blurb renders under the section header in the content pane.
const SETTINGS_SECTIONS = [
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
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

// The banner section used to be "announcement" (singular, pre-#180); keep
// saved deep links to it working.
const LEGACY_SECTION_ALIASES: Record<string, SettingsSectionId> = {
  announcement: "announcements",
};

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

// Time-zone suggestions are browser data: Node's ICU zone list can differ
// from the browser's (417 vs 418 entries in practice), so server-rendering
// the datalist makes hydration flag a mismatch on every load. Serve an empty
// list and fill in the browser's own after mount (useSyncExternalStore's
// server/client snapshot split) — the suggestions are pure progressive
// enhancement. The snapshots are cached: getSnapshot must be referentially
// stable or the store re-syncs forever.
const NO_ZONES: string[] = [];
let zonesCache: string[] | null = null;
const getBrowserZones = () => (zonesCache ??= supportedTimezones());
const subscribeZonesNever = () => () => {};

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

// One feed card in the RSS settings section (#167): its enable toggle, URL
// list (each row with a Test/autodiscover button and passive fetch-health
// badge), title, entry count, and summaries toggle. The board can hold several
// — each is a config instance the layout editor places independently — so the
// header carries a Move/Remove affordance and a label that falls back to the
// card's number. Owns its own URL-rows keying, so it must be its own component
// (hooks can't be called inside the parent's feeds.map).
function FeedCardEditor({
  feed,
  index,
  count,
  health,
  onChange,
  onRemove,
  onMove,
}: {
  feed: FeedConfig;
  index: number;
  count: number;
  health: Record<string, FeedHealth> | null;
  onChange: (next: FeedConfig) => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const setUrls = (update: (prev: string[]) => string[]) =>
    onChange({ ...feed, urls: update(feed.urls) });
  const urlRows = useKeyedRows(feed.urls, setUrls);
  const updateUrl = (i: number, url: string) =>
    setUrls((urls) => urls.map((u, idx) => (idx === i ? url : u)));
  const label = feed.title.trim() || `Feed card ${index + 1}`;
  return (
    <div className={`${subCardClasses} flex flex-col gap-3 p-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {count > 1 && (
            <MoveButtons
              index={index}
              count={count}
              label={label}
              onMove={onMove}
            />
          )}
          <span className={`${fieldLabelClasses} truncate`}>{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer items-center">
            <Switch
              checked={feed.enabled}
              onChange={(enabled) => onChange({ ...feed, enabled })}
              label={`${label} enabled`}
            />
          </label>
          {count > 1 && (
            <RemoveButton label={`Remove ${label}`} onClick={onRemove} />
          )}
        </div>
      </div>
      {feed.enabled && (
        <>
          <ListPanel label="Feed URLs (RSS, Atom, or JSON Feed)">
            {feed.urls.map((url, i) => (
              <div
                key={urlRows.keys[i] ?? i}
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-center gap-2">
                  {feed.urls.length > 1 && (
                    <MoveButtons
                      index={i}
                      count={feed.urls.length}
                      label={`${label} feed ${i + 1}`}
                      onMove={urlRows.move}
                    />
                  )}
                  <input
                    value={url}
                    onChange={(e) => updateUrl(i, e.target.value)}
                    placeholder="https://example.com/feed.xml"
                    aria-label={`${label} URL ${i + 1}`}
                    className={`${controlClasses} min-w-0 flex-1`}
                  />
                  <RemoveButton
                    label={`Remove ${label} feed ${i + 1}`}
                    onClick={() => urlRows.removeAt(i)}
                  />
                </div>
                {url.trim() !== "" && (
                  <div className="flex flex-col gap-1.5">
                    <FeedTest
                      url={url}
                      onPick={(picked) => updateUrl(i, picked)}
                    />
                    <FeedHealthBadge health={health?.[url.trim()]} />
                  </div>
                )}
              </div>
            ))}
            {feed.urls.length < MAX_FEED_URLS && (
              <AddButton onClick={() => urlRows.add("")}>+ Add feed</AddButton>
            )}
          </ListPanel>
          <TextField
            label="Card title (optional — defaults to the first feed's own)"
            placeholder=""
            value={feed.title}
            onChange={(e) => onChange({ ...feed, title: e.target.value })}
          />
          <NumberRow
            label="Entries to show"
            min={1}
            max={15}
            value={feed.count}
            onChange={(nextCount) => onChange({ ...feed, count: nextCount })}
          />
          <ToggleRow
            label="Show summaries"
            hint="Add a short snippet from each entry under its headline."
            checked={feed.summaries}
            onChange={(summaries) => onChange({ ...feed, summaries })}
          />
        </>
      )}
    </div>
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
    // Trim each feed card's blank URL rows up front (the resolved list, like
    // the home page uses), so a half-typed row saved earlier doesn't linger.
    feeds: initialSettings.feeds.map((f) => ({ ...f, urls: feedUrls(f) })),
  }));
  // The URL seeds the active section (?tab=settings&section=widgets is a
  // shareable deep link that survives refresh); rail clicks mirror it back
  // with a history replace. AdminDashboard owns the `tab` param the same way.
  const [section, setSection] = useState<SettingsSectionId>(() => {
    if (SETTINGS_SECTIONS.some((s) => s.id === initialSection))
      return initialSection as SettingsSectionId;
    return (initialSection && LEGACY_SECTION_ALIASES[initialSection]) || "general";
  });
  const activeSection =
    SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];

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
  // Empty on the server and during hydration, the browser's own list after
  // mount — see the NO_ZONES/getBrowserZones comment above.
  const zones = useSyncExternalStore(
    subscribeZonesNever,
    getBrowserZones,
    () => NO_ZONES
  );

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
  // Feed cards: a list of instances (#167). Each is edited whole through its
  // stable id; the layout editor places each by matching instanceId.
  const feeds = settings.feeds;
  const setFeeds = (update: (prev: FeedConfig[]) => FeedConfig[]) =>
    setSettings((s) => ({ ...s, feeds: update(s.feeds) }));
  const updateFeedCard = (id: string, next: FeedConfig) =>
    setFeeds((fs) => fs.map((f) => (f.id === id ? next : f)));
  const addFeedCard = () =>
    setFeeds((fs) =>
      fs.length >= MAX_FEED_CARDS
        ? fs
        : [
            ...fs,
            {
              id: newThemeId(),
              enabled: true,
              urls: [""],
              count: 6,
              title: "",
              summaries: false,
            },
          ]
    );
  const removeFeedCard = (id: string) =>
    setFeeds((fs) => fs.filter((f) => f.id !== id));
  const moveFeedCard = (from: number, to: number) =>
    setFeeds((fs) => reorder(fs, from, to));
  // Health covers every URL the home page has fetched; each card reads its own
  // rows out of it. Poll while any card is enabled.
  const feedHealth = useFeedHealth(
    section === "widgets" && feeds.some((f) => f.enabled)
  );

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
      {/* Shared zone suggestions for every `list="settings-tz"` input — the
          default time zone (General) and the world clocks (Widgets) — so it
          can't be stranded in one section's DOM. */}
      <datalist id="settings-tz">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 lg:sticky lg:top-6 lg:flex-col lg:flex-nowrap lg:self-start"
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

      <div className="flex min-w-0 flex-col gap-4">
        {/* Section header: which group is open (the rail is far away on
            phones), its one-line scope, and the autosave state on the right. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="text-lg font-semibold">{activeSection.label}</h2>
            <p className="text-xs text-fg/40">{activeSection.blurb}</p>
          </div>
          <SaveStatus status={status} error={error} />
        </div>

        {/* The group's cards use the whole content cell (#161) on a GRID: one
            column normally, two side-by-side once the cell gives each ~500px+
            (container query, so the split follows the actual cell, not the
            viewport). A grid, not CSS columns (#134/#180): DOM order is
            reading order — left-right, top-bottom — and a card growing
            (enabling a feature) never re-positions its neighbors. Rows keep
            the default stretch alignment so a row's two cards share a height
            and the columns stay level (#64's imbalance, finally resolved):
            a short card gains interior breathing room instead of leaving a
            hole in the page beside a taller neighbor. */}
        <div className="@container">
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-2">
        {section === "general" && (
        <Card title="Site">
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
          <label className="flex flex-col gap-1.5 text-sm">
            <span className={fieldLabelClasses}>Default time zone</span>
            <input
              list="settings-tz"
              value={settings.timezone}
              onChange={(e) =>
                setSettings({ ...settings, timezone: e.target.value })
              }
              placeholder="Search a time zone…"
              className={controlClasses}
            />
          </label>
        </Card>
        )}

        {section === "general" && (
        <Card
          title="Appearance"
          intro={
            <>
              The site-wide default look visitors see before they customize
              their own. Pick a theme as the default; edit the themes themselves
              in the <span className="text-fg/60">Themes</span> tab.
            </>
          }
        >
          <ControlRow label="Default mode">
            <ChipGroup
              label="Default mode"
              capitalize
              shrink
              options={(["system", "light", "dark"] as const).map((m) => ({
                value: m,
                label: m,
              }))}
              value={theme.mode}
              onChange={(mode) => updateTheme({ mode })}
            />
          </ControlRow>

          <SelectField
            label="Default theme"
            value={theme.preset ?? ""}
            onChange={(e) => applyDefaultTheme(e.target.value)}
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
          </SelectField>

          <SelectField
            label="Light mode look"
            value={theme.presetLight ?? ""}
            onChange={(e) => applyLightDefault(e.target.value)}
            hint={
              <>
                Give light mode its own design, scene &amp; colors — leave on{" "}
                <span className="text-fg/60">Same as default</span> to mirror
                the theme above.
              </>
            }
          >
            <option value="">Same as default</option>
            {themePacks.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </SelectField>

          {/* Theme packs deliberately don't carry a font, so the default font
              is its own control rather than part of the pack selects above.
              Each option renders in its own face (every font is loaded up
              front in the root layout, so the variables exist here too). */}
          <SelectField
            label="Default font"
            value={theme.font}
            onChange={(e) => updateTheme({ font: e.target.value as FontId })}
            style={{ fontFamily: fontVar(theme.font) }}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
                {f.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Light mode font"
            value={theme.fontLight ?? ""}
            onChange={(e) =>
              updateTheme({
                fontLight: (e.target.value || undefined) as FontId | undefined,
              })
            }
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
          </SelectField>

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
        </Card>
        )}

        {section === "layout" && (
        <Card
          title="Visible widgets"
          intro="Show or hide home-page widgets. Weather and the calendar are toggled under Widgets, the status row under Monitoring; the split clock/weather/status widgets are managed in the home-page editor."
        >
          <div className="flex flex-col gap-2.5">
            {widgetToggles.map((t) => (
              <ToggleRow
                key={t.id}
                label={t.label}
                checked={isWidgetShown(t.id)}
                onChange={(shown) => setWidgetShown(t.id, shown)}
              />
            ))}
            {componentToggles.map((t) => (
              <ToggleRow
                key={t.key}
                label={t.label}
                checked={components[t.key]}
                onChange={(value) => setComponent(t.key, value)}
              />
            ))}
          </div>
          {!components.settingsButton && (
            <Hint>
              With the floating navigation menu off, reach this page directly at
              /admin.
            </Hint>
          )}
        </Card>
        )}

        {section === "layout" && (
        <Card
          title="Arrangement"
          intro="Widgets are arranged directly on the home page: drag to reorder, resize by dragging a card's edges, and show or hide everything in place — including swapping the header card for the split clock, weather, and status widgets."
        >
          <Link href="/?edit=1" className={`${buttonClasses("ghost", "sm")} self-start`}>
            Arrange the home page
          </Link>
        </Card>
        )}

        {section === "widgets" && (
        <Card title="Search engine">
          <SelectField
            label="Search bar engine"
            value={settings.search.engine}
            onChange={(e) =>
              setSettings({
                ...settings,
                search: { ...settings.search, engine: e.target.value as SearchEngine },
              })
            }
          >
            {SEARCH_ENGINE_KEYS.map((key) => (
              <option key={key} value={key}>
                {key === "custom" ? "Custom…" : SEARCH_ENGINES[key].label}
              </option>
            ))}
          </SelectField>
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
          <Hint>
            Pressing Enter in the search bar opens the top match, or searches
            here when nothing matches.
          </Hint>
        </Card>
        )}

        {section === "widgets" && (
        <Card
          title="Custom bangs"
          intro={
            <>
              Type <span className="text-fg/60">!key term</span> in the search
              bar to jump to a site (use <span className="text-fg/60">%s</span>{" "}
              for the term). Built-ins (<span className="text-fg/60">!yt</span>,{" "}
              <span className="text-fg/60">!gh</span>,{" "}
              <span className="text-fg/60">!w</span>…) plus your app names and
              subtitles work already.
            </>
          }
        >
          <ListPanel>
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
                  className={`${controlClasses} w-24`}
                />
                <input
                  value={b.url}
                  onChange={(e) => updateBang(i, { url: e.target.value })}
                  placeholder="https://example.com/search?q=%s"
                  aria-label={`Bang ${i + 1} URL`}
                  className={`${controlClasses} min-w-0 flex-1`}
                />
                <RemoveButton
                  label={`Remove bang ${i + 1}`}
                  onClick={() => bangRows.removeAt(i)}
                />
              </div>
            ))}
            <AddButton onClick={() => bangRows.add({ key: "", url: "" })}>
              + Add bang
            </AddButton>
          </ListPanel>
        </Card>
        )}

        {section === "widgets" && (
        <Card
          title="Weather"
          toggle={{
            checked: settings.weather.enabled,
            onChange: (enabled) =>
              setSettings({
                ...settings,
                weather: { ...settings.weather, enabled },
              }),
          }}
        >
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClasses}>Default location</span>
            <CitySearch
              onSelect={(latitude, longitude) =>
                setSettings({
                  ...settings,
                  weather: { ...settings.weather, latitude, longitude },
                })
              }
            />
            <Hint>
              Search a city to set the coordinates, or enter them manually.
            </Hint>
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

          <SelectField
            label="Units"
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
          >
            <option value="imperial">Imperial (°F)</option>
            <option value="metric">Metric (°C)</option>
          </SelectField>
        </Card>
        )}

        {section === "widgets" && (
        <Card
          title="Calendar"
          intro="Show upcoming events from a published iCal (.ics) URL — or a private CalDAV/WebDAV calendar (e.g. a Nextcloud DAV URL) with credentials."
          toggle={{
            checked: calendar.enabled,
            onChange: (enabled) => updateCalendar({ enabled }),
          }}
        >
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
              <SelectField
                label="Home widget view"
                value={calendar.homeView}
                onChange={(e) =>
                  updateCalendar({
                    homeView: e.target.value as "agenda" | "month",
                  })
                }
                hint="Agenda lists upcoming events; Month shows a mini calendar that links through. The /calendar page always opens on the month view."
              >
                <option value="agenda">Agenda</option>
                <option value="month">Month</option>
              </SelectField>
              {calendar.homeView === "agenda" && (
                <NumberRow
                  label="Events to show"
                  min={1}
                  max={20}
                  value={calendar.count}
                  onChange={(count) => updateCalendar({ count })}
                />
              )}
              <ToggleRow
                label="Hide when no upcoming events"
                hint={
                  <>
                    Drop the home-page card when the agenda is empty. The{" "}
                    /calendar page is unaffected.
                  </>
                }
                checked={calendar.hideWhenEmpty}
                onChange={(hideWhenEmpty) => updateCalendar({ hideWhenEmpty })}
              />
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
              <Hint>
                For a private calendar, paste its CalDAV/WebDAV collection URL
                and credentials (a Nextcloud app password is recommended); the
                events are fetched server-side. The password can instead come
                from the CTRLCENTER_CALDAV_PASS env var. Times show in each
                visitor&apos;s time zone; repeating events expand for common
                rules (daily/weekly/monthly).
              </Hint>
            </>
          )}
        </Card>
        )}

        {section === "widgets" && (
        <Card
          title="RSS feed"
          intro="Show the latest entries from one or more RSS, Atom, or JSON feeds, merged newest-first. Add several cards for topical sources — news, releases, blogs — each placed separately in the home-page layout editor. Fetched server-side and cached for a few minutes; cards ship hidden until you show them."
        >
          <div className="flex flex-col gap-3">
            {feeds.map((f, i) => (
              <FeedCardEditor
                key={f.id}
                feed={f}
                index={i}
                count={feeds.length}
                health={feedHealth}
                onChange={(next) => updateFeedCard(f.id, next)}
                onRemove={() => removeFeedCard(f.id)}
                onMove={moveFeedCard}
              />
            ))}
            {feeds.length < MAX_FEED_CARDS && (
              <AddButton onClick={addFeedCard}>+ Add feed card</AddButton>
            )}
            <Hint>
              Within a card, several feeds merge newest-first and each entry
              shows its source. Add separate cards to place feeds independently
              on the dashboard.
            </Hint>
          </div>
        </Card>
        )}

        {section === "widgets" && (
        <Card
          title="Notes"
          intro="A free-form note card for the home page. Ships hidden — show it in the home-page layout editor (or the Home layout section) once there's something to say."
        >
          <TextField
            label="Card title"
            placeholder="Notes"
            value={notes.title}
            onChange={(e) => updateNotes({ title: e.target.value })}
          />
          <TextArea
            label="Note (markdown)"
            mono
            value={notes.content}
            onChange={(e) => updateNotes({ content: e.target.value })}
            rows={10}
            placeholder={"# Homelab\n- Renew certs **June 12**\n- `docker compose pull` after backups"}
          />
          <Hint>
            Supports a safe markdown subset: # ## ### headings, **bold**,
            *italic*, `code`, [links](https://…) (http/https only), - and 1.
            lists, &gt; quotes, ``` code blocks and --- rules. Raw HTML is shown
            as plain text, never rendered.
          </Hint>
        </Card>
        )}

        {section === "widgets" && (
        <Card
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
          <ListPanel label="Dates">
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
                  className={`${controlClasses} min-w-0 flex-1`}
                />
                <input
                  type="date"
                  value={item.date}
                  onChange={(e) => updateCountdownItem(i, { date: e.target.value })}
                  aria-label={`Countdown ${i + 1} date`}
                  className={`${controlClasses} shrink-0`}
                />
                <RemoveButton
                  label={`Remove countdown ${i + 1}`}
                  onClick={() => countdownRows.removeAt(i)}
                />
              </div>
            ))}
            <AddButton onClick={() => countdownRows.add({ label: "", date: "" })}>
              + Add date
            </AddButton>
          </ListPanel>
          <Hint>
            Days count in each visitor&apos;s own time zone. Past dates dim and
            sink below the upcoming ones.
          </Hint>
        </Card>
        )}

        {section === "widgets" && (
        <Card
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
          <ListPanel label="Time zones">
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
                  className={`${controlClasses} min-w-0 flex-1`}
                />
                <input
                  list="settings-tz"
                  value={item.timeZone}
                  onChange={(e) => updateWorldClockItem(i, { timeZone: e.target.value })}
                  placeholder="Time zone…"
                  aria-label={`World clock ${i + 1} time zone`}
                  className={`${controlClasses} min-w-0 flex-1`}
                />
                <RemoveButton
                  label={`Remove world clock ${i + 1}`}
                  onClick={() => worldClockRows.removeAt(i)}
                />
              </div>
            ))}
            <AddButton
              onClick={() => worldClockRows.add({ label: "", timeZone: "" })}
            >
              + Add time zone
            </AddButton>
          </ListPanel>
          <Hint>
            Each clock shows the current time in its own zone. Leave the label
            blank to use the zone&apos;s city name.
          </Hint>
        </Card>
        )}

        {section === "widgets" && (
        <Card
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
          <ListPanel label="Extra disks">
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
                  className={`${controlClasses} min-w-0 flex-1`}
                />
                <input
                  value={disk.path}
                  onChange={(e) => updateStatDisk(i, { path: e.target.value })}
                  placeholder="/mnt/media"
                  aria-label={`Disk ${i + 1} path`}
                  className={`${controlClasses} min-w-0 flex-1`}
                />
                <RemoveButton
                  label={`Remove disk ${i + 1}`}
                  onClick={() => statDiskRows.removeAt(i)}
                />
              </div>
            ))}
            {systemStats.disks.length < MAX_STAT_DISKS && (
              <AddButton onClick={() => statDiskRows.add({ label: "", path: "" })}>
                + Add disk
              </AddButton>
            )}
          </ListPanel>
          <Hint>
            The data volume is always shown. A path here has to be mounted into
            the app&apos;s container to be measurable; a path that isn&apos;t is
            simply skipped.
          </Hint>
        </Card>
        )}

        {section === "monitoring" && (
        <Card
          title="Status checks"
          intro="Show an online/offline dot on each app and record its uptime. The server pings every app URL, so leave off if your apps aren't reachable from it."
          toggle={{
            checked: settings.statusChecks,
            onChange: (statusChecks) =>
              setSettings({ ...settings, statusChecks }),
          }}
        >
          {settings.statusChecks && (
            <>
              {/* A hand-edited config value (the schema allows 1–60) matches
                  no preset; `offLabel` surfaces it as a read-only chip so the
                  control never reads as "nothing selected". */}
              <ControlRow
                label="Uptime check interval"
                hint="How often the server records each app's up/down for the 90-day history on the status page."
              >
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
              </ControlRow>

              <ControlRow
                label="Default status range"
                hint="Which time range the status page opens on."
              >
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
              </ControlRow>
            </>
          )}
        </Card>
        )}

        {section === "monitoring" && (
        <Card
          title="Alerts"
          intro="Notify a webhook and/or email when an app goes down or recovers. Requires the status checks to be on."
          toggle={{
            checked: alerts.enabled,
            onChange: (enabled) => updateAlerts({ enabled }),
          }}
        >
          {alerts.enabled && (
            <>
              <ToggleRow
                label="Notify on recovery"
                checked={alerts.notifyOnRecovery}
                onChange={(notifyOnRecovery) =>
                  updateAlerts({ notifyOnRecovery })
                }
              />

              <NumberRow
                label="Confirmations before down"
                hint="Consecutive failed checks required first."
                min={1}
                max={10}
                value={alerts.confirmations}
                onChange={(confirmations) => updateAlerts({ confirmations })}
              />

              {/* Two independent channels, each with its own toggle — enable
                  either, both, or neither. */}
              <div className="mt-1 flex flex-col gap-3 border-t border-fg/10 pt-4">
                <ToggleRow
                  label="Webhook"
                  hint="Post to a generic JSON endpoint, Discord, Slack, or ntfy."
                  checked={alerts.webhookEnabled}
                  onChange={(webhookEnabled) =>
                    updateAlerts({ webhookEnabled })
                  }
                />
                {alerts.webhookEnabled && (
                  <div className="flex flex-col gap-3">
                    <SelectField
                      label="Notify via"
                      value={alerts.type}
                      onChange={(e) =>
                        updateAlerts({
                          type: e.target.value as Settings["alerts"]["type"],
                        })
                      }
                    >
                      {ALERT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {alertTypeLabel[t]}
                        </option>
                      ))}
                    </SelectField>
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
                <ToggleRow
                  label="Email (SMTP)"
                  hint="Optional — email on down/recovery, independent of the webhook. Works with any SMTP service (SMTP2GO, Gmail, Fastmail, a relay)."
                  checked={alerts.email.enabled}
                  onChange={(enabled) => updateAlertEmail({ enabled })}
                />

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
                      <NumberField
                        label="Port"
                        min={1}
                        max={65535}
                        value={alerts.email.port}
                        onChange={(port) => updateAlertEmail({ port })}
                      />
                    </div>

                    <ToggleRow
                      label="Implicit TLS (port 465)"
                      hint="Leave off for 587/STARTTLS."
                      checked={alerts.email.secure}
                      onChange={(secure) => updateAlertEmail({ secure })}
                    />

                    <TextField
                      label="Username"
                      autoComplete="off"
                      value={alerts.email.user}
                      onChange={(e) => updateAlertEmail({ user: e.target.value })}
                    />
                    <TextField
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      value={alerts.email.pass}
                      onChange={(e) => updateAlertEmail({ pass: e.target.value })}
                      hint="Stored in config.yaml. Set the CTRLCENTER_SMTP_PASS env var to keep it out of the file instead."
                    />
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
                    <TextField
                      label="Subject"
                      placeholder="{service} is {status}"
                      value={alerts.email.subject}
                      onChange={(e) =>
                        updateAlertEmail({ subject: e.target.value })
                      }
                      hint={
                        <>
                          Variables: <code>{"{service}"}</code> and{" "}
                          <code>{"{status}"}</code> (down/up). Blank uses the
                          default.
                        </>
                      }
                    />
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
        </Card>
        )}

        {section === "announcements" && (
        <Card
          title="Site-wide banner"
          intro="A banner across the top of every page — maintenance windows, notices, a heads-up for the household. Turn it on, write the message, and it shows site-wide until you turn it off."
          toggle={{
            checked: announcement.enabled,
            onChange: (enabled) => updateAnnouncement({ enabled }),
          }}
        >
          <TextArea
            label="Message"
            value={announcement.message}
            onChange={(e) => updateAnnouncement({ message: e.target.value })}
            rows={3}
            placeholder={"**Maintenance tonight** 10–11pm — [status](https://…)"}
            hint="Supports inline **bold**, *italic*, `code` and [links](https://…) (http/https only). Raw HTML is shown as plain text, never rendered."
          />

          <SelectField
            label="Tone"
            value={announcement.tone}
            onChange={(e) =>
              updateAnnouncement({
                tone: e.target.value as Settings["announcement"]["tone"],
              })
            }
          >
            {ANNOUNCEMENT_TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABELS[t]}
              </option>
            ))}
          </SelectField>

          <ToggleRow
            label="Dismissible"
            hint="Let visitors close it; it returns if you change the message."
            checked={announcement.dismissible}
            onChange={(dismissible) => updateAnnouncement({ dismissible })}
          />
        </Card>
        )}

        {section === "announcements" && (
        <Card
          title="Status page announcements"
          intro="Maintenance windows and upcoming changes, posted on the status page. An entry with a start time in the future shows as scheduled; once its end time passes it stops showing. Independent of the status checks — a notice appears even with checks off."
        >
          <div className="flex flex-col gap-3">
            {statusAnnouncements.length === 0 && (
              <Hint>
                No announcements yet. Add one to post a maintenance window or
                notice on the status page.
              </Hint>
            )}
            {statusAnnouncements.map((a, i) => {
              const state = announcementState(a, now);
              return (
                <div
                  key={a.id}
                  className={`${subCardClasses} flex flex-col gap-3 p-4`}
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
                    <RemoveButton
                      label={`Remove announcement ${i + 1}`}
                      onClick={() => removeStatusAnnouncement(i)}
                    />
                  </div>

                  <TextField
                    label="Title"
                    value={a.title}
                    onChange={(e) =>
                      updateStatusAnnouncement(i, { title: e.target.value })
                    }
                  />

                  <TextArea
                    label="Message"
                    value={a.body}
                    onChange={(e) =>
                      updateStatusAnnouncement(i, { body: e.target.value })
                    }
                    rows={2}
                    placeholder={"Upgrading the NAS 10–11pm — some services may blip. [details](https://…)"}
                    hint="Supports inline **bold**, *italic*, `code` and [links](https://…) (http/https only). Raw HTML is shown as plain text."
                  />

                  <div className="flex flex-col gap-1.5">
                    <span className={fieldLabelClasses}>Kind</span>
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
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className={fieldLabelClasses}>Starts (optional)</span>
                      <input
                        type="datetime-local"
                        value={isoToLocalInput(a.startsAt)}
                        onChange={(e) =>
                          updateStatusAnnouncement(i, {
                            startsAt: localInputToIso(e.target.value),
                          })
                        }
                        className={controlClasses}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className={fieldLabelClasses}>Ends (optional)</span>
                      <input
                        type="datetime-local"
                        value={isoToLocalInput(a.endsAt)}
                        onChange={(e) =>
                          updateStatusAnnouncement(i, {
                            endsAt: localInputToIso(e.target.value),
                          })
                        }
                        className={controlClasses}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
            <AddButton onClick={addStatusAnnouncement}>
              + Add announcement
            </AddButton>
          </div>
          <Hint>
            Leave both times empty to show a notice until you remove it. Times
            use this browser&apos;s time zone; visitors see them in their own.
          </Hint>
        </Card>
        )}

        {section === "security" && (
        <Card
          title="Password"
          intro="The password used to sign in to this admin portal."
        >
          <ChangePassword />
        </Card>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}
