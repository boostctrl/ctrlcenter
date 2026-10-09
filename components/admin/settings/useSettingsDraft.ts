"use client";

import { useCallback, useRef, useState } from "react";
import type { Settings, SettingsInput, WidgetInstance } from "@/lib/schema";
import {
  type WebhookService,
  alertChannelSchema,
  feedUrls,
  newInstance,
  MAX_FEED_CARDS,
} from "@/lib/schema";
import { moveLegacyIntoChannels } from "@/lib/alert-channels";
import type { ThemePack } from "@/lib/theme";
import { newThemeId } from "@/lib/prefs";
import {
  defaultSpanFor,
  resolveLayout,
  toSections,
  type LayoutWidget,
  type WidgetType,
} from "@/lib/layout";
import { instanceLabels } from "@/lib/widgets/labels";
import { useConfirm } from "../Confirm";
import { useAutosave, type SaveOptions, type SaveState } from "../useAutosave";
import { settingsPatch } from "../settingsPatch";
import { saveSettingsPatch, saveWidgets } from "../settingsApi";
import { useKeyedRows } from "./useKeyedRows";

// The settings form's state: the draft settings object, the autosave that
// persists it, and the per-section updaters every section component edits
// it through. One hook so the sections share a single draft and autosave.
// The settings as the form holds them: the layout resolved against the widget
// instances (each row bound to its instance and type), stored back by id.
export type DraftSettings = Omit<Settings, "layout"> & {
  layout: Omit<Settings["layout"], "sections"> & { sections: LayoutWidget[] };
};

// A fresh instance id: the type, then a short random suffix.
const newInstanceId = (type: WidgetType) => `${type}-${newThemeId().slice(0, 8)}`;

export function useSettingsDraft(
  initialSettings: Settings,
  initialWidgets: WidgetInstance[],
  themePacks: ThemePack[]
) {
  // Resolve the layout up front: this form saves the layout as one whole
  // object whenever it changes, and the strict layout update schema requires
  // every row complete.
  const [settings, setSettings] = useState<DraftSettings>(() => ({
    ...initialSettings,
    layout: {
      // Keep columns/scale — this form autosaves the whole layout object, so
      // dropping them here would reset them on the next save.
      ...initialSettings.layout,
      sections: resolveLayout(initialSettings.layout.sections, initialWidgets),
    },
  }));
  // The widget instances (#297), with their own autosave to /api/widgets. A
  // feed card's blank URL rows are trimmed up front (the resolved list, like
  // the home page uses), so a half-typed row saved earlier doesn't linger.
  const [widgets, setWidgets] = useState<WidgetInstance[]>(() =>
    initialWidgets.map((w) => (w.type === "feed" ? { ...w, urls: feedUrls(w) } : w))
  );
  // Persistence is automatic: every change debounce-saves via useAutosave —
  // only the keys that changed since the last successful save (settingsPatch),
  // so this tab can't revert what another surface saved meanwhile. `saved`
  // starts as the initial state; useAutosave serializes saves, and a failed
  // save leaves it unchanged so its keys go out again with the next one.
  const saved = useRef<DraftSettings>(settings);
  const save = useCallback(async (next: DraftSettings, opts?: SaveOptions) => {
    const patch = settingsPatch(saved.current, next);
    if (Object.keys(patch).length === 0) return;
    const body = patch.layout
      ? { ...patch, layout: { ...patch.layout, sections: toSections(patch.layout.sections) } }
      : patch;
    await saveSettingsPatch(body as SettingsInput, { keepalive: opts?.keepalive });
    saved.current = next;
  }, []);
  const settingsSave = useAutosave(settings, save);
  const widgetsSave = useAutosave(widgets, async (next, opts) => {
    await saveWidgets(next, { keepalive: opts?.keepalive });
  });
  // One status for the header: saving while either is, else the latest error.
  const status: SaveState =
    settingsSave.status === "saving" || widgetsSave.status === "saving"
      ? "saving"
      : settingsSave.status === "error" || widgetsSave.status === "error"
        ? "error"
        : settingsSave.status === "saved" || widgetsSave.status === "saved"
          ? "saved"
          : "idle";
  const error = settingsSave.error ?? widgetsSave.error;
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

  // Widget visibility lives on the layout rows (the on-page editor owns the
  // arrangement; these switches are the same `hidden` flags), by instance id.
  const layoutWidgets = settings.layout.sections;
  const isWidgetShown = (id: string) => !layoutWidgets.find((w) => w.id === id)?.hidden;
  const setWidgetShown = (id: string, shown: boolean) =>
    setSettings((s) => ({
      ...s,
      layout: {
        ...s.layout,
        sections: s.layout.sections.map((w) => (w.id === id ? { ...w, hidden: !shown } : w)),
      },
    }));

  // The widget instances (#297).
  const widgetLabels = instanceLabels(widgets);
  const instancesOf = (type: WidgetType) => widgets.filter((w) => w.type === type);
  const updateWidget = (id: string, patch: Partial<WidgetInstance>) =>
    setWidgets((ws) =>
      ws.map((w) => (w.id === id ? ({ ...w, ...patch } as WidgetInstance) : w))
    );
  // A new instance goes to the end of the list and onto the board, shown: the
  // admin asked for it, and an empty one renders nothing until filled in.
  const addWidget = (type: WidgetType) => {
    if (type === "feed" && instancesOf("feed").length >= MAX_FEED_CARDS) return;
    const id = newInstanceId(type);
    const fresh = newInstance(type, id);
    setWidgets((ws) => [...ws, type === "feed" ? { ...fresh, enabled: true, urls: [""] } : fresh]);
    setSettings((s) => ({
      ...s,
      layout: {
        ...s.layout,
        sections: [...s.layout.sections, { id, type, span: defaultSpanFor(type), hidden: false }],
      },
    }));
  };
  const removeWidget = async (id: string) => {
    const ok = await confirm({
      title: `Remove ${widgetLabels[id] ?? "this widget"}?`,
      message: "Its content goes with it.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setWidgets((ws) => ws.filter((w) => w.id !== id));
    setSettings((s) => ({
      ...s,
      layout: { ...s.layout, sections: s.layout.sections.filter((w) => w.id !== id) },
    }));
  };
  // The widgets with no settings of their own, switched on and off here; the
  // content widgets have their switch beside their editor (Widgets tab).
  // Order mirrors roughly top-to-bottom on the page.
  const PLAIN_TYPES: WidgetType[] = ["greeting", "headerCard", "search", "apps", "bookmarks", "favorites"];
  const widgetToggles = PLAIN_TYPES.flatMap((type) =>
    instancesOf(type).map((w) => ({ id: w.id, label: widgetLabels[w.id] }))
  );
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

  const announcement = settings.announcement;
  const updateAnnouncement = (patch: Partial<Settings["announcement"]>) =>
    setSettings((s) => ({
      ...s,
      announcement: { ...s.announcement, ...patch },
    }));

  // Every list editor below threads a FUNCTIONAL updater through setSettings
  // (update off the latest sub-array, never a render-captured snapshot), so a
  // batched pair of row mutations can't drop data — see useKeyedRows.
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
    layoutWidgets,
    isWidgetShown,
    setWidgetShown,
    widgetToggles,
    widgets,
    widgetLabels,
    instancesOf,
    updateWidget,
    addWidget,
    removeWidget,
    alertTypeLabel,
    alertUrlPlaceholder,
    announcement,
    updateAnnouncement,
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
