"use client";

import { useCallback, useRef, useState } from "react";
import type { Settings, SettingsInput, FeedConfig } from "@/lib/schema";
import { type WebhookService, alertChannelSchema, feedUrls, MAX_FEED_CARDS } from "@/lib/schema";
import { moveLegacyIntoChannels } from "@/lib/alert-channels";
import type { ThemePack } from "@/lib/theme";
import { newThemeId } from "@/lib/prefs";
import { resolveLayoutWidgets, type LayoutWidgetId } from "@/lib/layout";
import { reorder } from "../useReorder";
import { useConfirm } from "../Confirm";
import { useAutosave, type SaveOptions } from "../useAutosave";
import { settingsPatch } from "../settingsPatch";
import { saveSettingsPatch } from "../settingsApi";
import { useKeyedRows } from "./useKeyedRows";

// The settings form's state: the draft settings object, the autosave that
// persists it, and the per-section updaters every section component edits
// it through. One hook so the sections share a single draft and autosave.
export function useSettingsDraft(initialSettings: Settings, themePacks: ThemePack[]) {
  // Resolve the layout up front: stored entries can omit `hidden` (the legacy
  // components toggles fold in at resolve time), but this form saves the
  // layout as one whole object whenever it changes, and the strict layout
  // update schema requires every widget fully resolved.
  const [settings, setSettings] = useState(() => ({
    ...initialSettings,
    layout: {
      // Keep columns/scale — this form autosaves the whole layout object, so
      // dropping them here would reset them on the next save.
      ...initialSettings.layout,
      // Pass the configured feed instance ids (like app/page.tsx does):
      // without them resolveLayoutWidgets keeps only the stock "feed" instance
      // and drops every other feed card as an orphan — and since this form
      // autosaves the whole layout, that drop would persist and un-place a
      // placed RSS card the next time any setting is saved (#187).
      sections: resolveLayoutWidgets(
        initialSettings.layout.sections,
        initialSettings.components,
        initialSettings.feeds.map((f) => f.id)
      ),
    },
    // Trim each feed card's blank URL rows up front (the resolved list, like
    // the home page uses), so a half-typed row saved earlier doesn't linger.
    feeds: initialSettings.feeds.map((f) => ({ ...f, urls: feedUrls(f) })),
  }));
  // Persistence is automatic: every change debounce-saves via useAutosave —
  // only the keys that changed since the last successful save (settingsPatch),
  // so this tab can't revert what another surface saved meanwhile. `saved`
  // starts as the initial state; useAutosave serializes saves, and a failed
  // save leaves it unchanged so its keys go out again with the next one.
  const saved = useRef<Settings>(settings);
  const save = useCallback(async (next: Settings, opts?: SaveOptions) => {
    const patch = settingsPatch(saved.current, next);
    if (Object.keys(patch).length === 0) return;
    await saveSettingsPatch(patch as SettingsInput, { keepalive: opts?.keepalive });
    saved.current = next;
  }, []);
  const { status, error } = useAutosave(settings, save);
  const confirm = useConfirm();

  const theme = settings.theme;
  const updateTheme = (patch: Partial<Settings["theme"]>) =>
    setSettings((s) => ({ ...s, theme: { ...s.theme, ...patch } }));

  const alerts = settings.alerts;
  const updateAlerts = (patch: Partial<Settings["alerts"]>) =>
    setSettings((s) => ({ ...s, alerts: { ...s.alerts, ...patch } }));
  // The channel list (#291). Updaters compose off the latest state, like the
  // other list editors, so quick successive adds can't drop a row.
  type Channel = Settings["alerts"]["channels"][number];
  const setChannels = (update: (prev: Channel[]) => Channel[]) =>
    setSettings((s) => ({ ...s, alerts: { ...s.alerts, channels: update(s.alerts.channels) } }));
  const addChannel = () =>
    setChannels((cs) => [...cs, alertChannelSchema.parse({ id: newThemeId(), type: "webhook" })]);
  const updateChannel = (id: string, patch: Partial<Channel>) =>
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeChannel = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Remove the ${label} channel?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setChannels((cs) => cs.filter((c) => c.id !== id));
  };
  const moveLegacyChannels = () =>
    setSettings((s) => ({
      ...s,
      alerts: { ...s.alerts, ...moveLegacyIntoChannels(s.alerts, newThemeId) },
    }));

  const integrations = settings.integrations;
  const updateIntegration = <K extends keyof Settings["integrations"]>(
    service: K,
    patch: Partial<Settings["integrations"][K]>
  ) =>
    setSettings((s) => ({
      ...s,
      integrations: {
        ...s.integrations,
        [service]: { ...s.integrations[service], ...patch },
      },
    }));

  // Inbound webhooks (#204). Toggling a service on mints a token if it has none;
  // "Regenerate" rotates it (invalidating the old URL). A random 32-hex token —
  // crypto.randomUUID is available in every browser this admin runs in.
  const webhooks = settings.webhooks;
  const updateWebhooks = (patch: Partial<Settings["webhooks"]>) =>
    setSettings((s) => ({ ...s, webhooks: { ...s.webhooks, ...patch } }));
  const updateWebhookService = (
    service: WebhookService,
    patch: Partial<Settings["webhooks"][WebhookService]>
  ) =>
    setSettings((s) => ({
      ...s,
      webhooks: {
        ...s.webhooks,
        [service]: { ...s.webhooks[service], ...patch },
      },
    }));
  const genWebhookToken = () => crypto.randomUUID().replace(/-/g, "");
  const toggleWebhookService = (service: WebhookService, enabled: boolean) =>
    updateWebhookService(
      service,
      enabled && !webhooks[service].token
        ? { enabled, token: genWebhookToken() }
        : { enabled }
    );

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

  // Status-page announcements: a client-managed list saved whole through the
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
      { id: newThemeId(), title: "", body: "", kind: "info", startsAt: "", endsAt: "", apps: [] },
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


  return {
    settings,
    setSettings,
    status,
    error,
    confirm,
    theme,
    updateTheme,
    alerts,
    updateAlerts,
    addChannel,
    updateChannel,
    removeChannel,
    moveLegacyChannels,
    integrations,
    updateIntegration,
    webhooks,
    updateWebhooks,
    updateWebhookService,
    genWebhookToken,
    toggleWebhookService,
    components,
    setComponent,
    layoutWidgets,
    isWidgetShown,
    setWidgetShown,
    widgetToggles,
    componentToggles,
    alertTypeLabel,
    alertUrlPlaceholder,
    calendar,
    updateCalendar,
    notes,
    updateNotes,
    announcement,
    updateAnnouncement,
    feeds,
    setFeeds,
    updateFeedCard,
    addFeedCard,
    removeFeedCard,
    moveFeedCard,
    countdown,
    setCountdownItems,
    countdownRows,
    updateCountdownItem,
    worldClocks,
    setWorldClockItems,
    worldClockRows,
    updateWorldClockItem,
    systemStats,
    setStatDisks,
    statDiskRows,
    updateStatDisk,
    statusAnnouncements,
    setStatusAnnouncements,
    updateStatusAnnouncement,
    addStatusAnnouncement,
    removeStatusAnnouncement,
    bangs,
    setBangs,
    bangRows,
    updateBang,
    applyDefaultTheme,
    applyLightDefault,
  };
}

export type SettingsDraft = ReturnType<typeof useSettingsDraft>;
