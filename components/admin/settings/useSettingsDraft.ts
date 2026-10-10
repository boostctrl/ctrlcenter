"use client";

import { useCallback, useRef, useState } from "react";
import type { AlertType, Board, BoardVisibility, Integration, Settings, SettingsInput, WidgetInstance } from "@/lib/schema";
import {
  type WebhookService,
  alertChannelSchema,
  feedUrls,
  newInstance,
  MAX_FEED_CARDS,
  MAX_BOARDS,
  newBoardId,
  integrationSchema,
} from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import { newThemeId } from "@/lib/prefs";
import { defaultSpanFor, resolveLayout, type WidgetType } from "@/lib/layout";
import { instanceLabels } from "@/lib/widgets/labels";
import { useConfirm } from "../Confirm";
import { useAutosave, type SaveOptions, type SaveState } from "../useAutosave";
import { settingsPatch } from "../settingsPatch";
import { saveBoards, saveIntegrations, saveSettingsPatch, saveWidgets } from "../settingsApi";
import type { ServiceId } from "@/lib/services/ids";
import { reorder } from "../useReorder";
import { useKeyedRows } from "./useKeyedRows";

// The settings form's state: the draft settings object, the autosave that
// persists it, and the per-section updaters every section component edits
// it through. One hook so the sections share a single draft and autosave.

// A fresh instance id: the type, then a short random suffix.
const newInstanceId = (type: WidgetType) => `${type}-${newThemeId().slice(0, 8)}`;

type Row = Board["layout"]["sections"][number];

export function useSettingsDraft(
  initialSettings: Settings,
  initialWidgets: WidgetInstance[],
  initialBoards: Board[],
  initialIntegrations: Integration[],
  themePacks: ThemePack[]
) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
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
  const saved = useRef<Settings>(settings);
  const save = useCallback(async (next: Settings, opts?: SaveOptions) => {
    const patch = settingsPatch(saved.current, next);
    if (Object.keys(patch).length === 0) return;
    await saveSettingsPatch(patch as SettingsInput, { keepalive: opts?.keepalive });
    saved.current = next;
  }, []);
  const settingsSave = useAutosave(settings, save);
  const widgetsSave = useAutosave(widgets, async (next, opts) => {
    await saveWidgets(next, { keepalive: opts?.keepalive });
  });
  // The boards (#298), with their own autosave to /api/boards. A board's rows
  // go out only when this form changed them since the last save, so it can't
  // overwrite an arrangement the on-page editor saved meanwhile.
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const savedBoards = useRef<Board[]>(initialBoards);
  // Which boards exist on the server yet: a new board's page 404s until its
  // first save lands, so its Arrange link waits for this.
  const [savedBoardIds, setSavedBoardIds] = useState<ReadonlySet<string>>(
    () => new Set(initialBoards.map((b) => b.id))
  );
  const boardsSave = useAutosave(boards, async (next, opts) => {
    const before = new Map(savedBoards.current.map((b) => [b.id, b.layout]));
    await saveBoards(
      next.map(({ id, name, visibility, icon, layout }) => ({
        id,
        name,
        visibility,
        // Sent every time ("" for none), so clearing one here sticks.
        icon: icon ?? "",
        ...(JSON.stringify(before.get(id)) === JSON.stringify(layout)
          ? {}
          : { layout: { sections: layout.sections } }),
      })),
      { keepalive: opts?.keepalive }
    );
    savedBoards.current = next;
    setSavedBoardIds(new Set(next.map((b) => b.id)));
  });
  const [integrations, setIntegrations] = useState<Integration[]>(initialIntegrations);
  const integrationsSave = useAutosave(integrations, async (next, opts) => {
    await saveIntegrations(next, { keepalive: opts?.keepalive });
  });
  // One status for the header: saving while any is, else the latest error.
  const saves = [settingsSave, widgetsSave, boardsSave, integrationsSave];
  const status: SaveState = saves.some((x) => x.status === "saving")
    ? "saving"
    : saves.some((x) => x.status === "error")
      ? "error"
      : saves.some((x) => x.status === "saved")
        ? "saved"
        : "idle";
  const error = saves.map((x) => x.error).find((e) => e) ?? null;
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

  // The integrations (#300): a list of instances with their own autosave.
  const updateIntegration = (id: string, patch: Partial<Integration>) =>
    setIntegrations((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  // A new integration's id is its type's while that's free (so the pre-3.0
  // environment variable applies to it, as to a migrated one), else the type
  // and a short random suffix.
  const addIntegration = (type: ServiceId) =>
    setIntegrations((list) => [
      ...list,
      integrationSchema.parse({
        id: list.some((i) => i.id === type) ? `${type}-${newThemeId().slice(0, 6)}` : type,
        type,
      }),
    ]);
  const moveIntegration = (from: number, to: number) => setIntegrations((list) => reorder(list, from, to));
  const removeIntegration = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: "Its connection settings go with it. The service itself isn't touched.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setIntegrations((list) => list.filter((i) => i.id !== id));
  };

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

  // Widget visibility lives on the home board's layout rows (the on-page
  // editor owns the arrangement; these switches are the same `hidden` flags),
  // by instance id. An instance the board has no row for is hidden there;
  // showing it adds the row at the end.
  const homeWidgets = resolveLayout(boards[0]?.layout.sections, widgets);
  const isWidgetShown = (id: string) => homeWidgets.find((w) => w.id === id)?.hidden === false;
  const updateHomeRows = (update: (rows: Row[]) => Row[]) =>
    setBoards((bs) =>
      bs.map((b, i) => (i === 0 ? { ...b, layout: { ...b.layout, sections: update(b.layout.sections) } } : b))
    );
  const setWidgetShown = (id: string, shown: boolean) => {
    const type = widgets.find((w) => w.id === id)?.type;
    if (!type) return;
    updateHomeRows((rows) =>
      rows.some((r) => r.widget === id)
        ? rows.map((r) => (r.widget === id ? { ...r, hidden: !shown } : r))
        : [...rows, { widget: id, span: defaultSpanFor(type), hidden: !shown }]
    );
  };

  // Board management (#298): add, rename, reorder, set visibility, delete.
  // Deleting a board takes only its arrangement; the widget instances it
  // placed stay (they're shared, and may sit on other boards).
  const addBoard = (name: string) => {
    if (boards.length >= MAX_BOARDS) return;
    setBoards((bs) => [
      ...bs,
      {
        id: newBoardId(name, bs.map((b) => b.id)),
        name: name.trim(),
        visibility: "public",
        layout: { sections: [] },
      },
    ]);
  };
  // An icon of "" clears it (#316).
  const updateBoard = (id: string, patch: { name?: string; visibility?: BoardVisibility; icon?: string }) =>
    setBoards((bs) =>
      bs.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...patch };
        if (!next.icon) delete next.icon;
        return next;
      })
    );
  const moveBoard = (from: number, to: number) => setBoards((bs) => reorder(bs, from, to));
  const removeBoard = async (id: string, label: string) => {
    if (boards.length <= 1) return;
    const ok = await confirm({
      title: `Delete the ${label} board?`,
      message: "Its arrangement goes with it. The widgets on it stay, ready to place on another board.",
      confirmLabel: "Delete board",
      danger: true,
    });
    if (!ok) return;
    setBoards((bs) => bs.filter((b) => b.id !== id));
  };

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
    setWidgets((ws) => [...ws, type === "feed" ? { ...fresh, urls: [""] } : fresh]);
    updateHomeRows((rows) => [...rows, { widget: id, span: defaultSpanFor(type), hidden: false }]);
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
    // Off every board it was placed on.
    setBoards((bs) =>
      bs.map((b) => ({
        ...b,
        layout: { ...b.layout, sections: b.layout.sections.filter((r) => r.widget !== id) },
      }))
    );
  };
  // The widgets with no settings of their own, switched on and off here; the
  // content widgets have their switch beside their editor (Widgets tab).
  // Order mirrors roughly top-to-bottom on the page.
  const PLAIN_TYPES: WidgetType[] = ["greeting", "headerCard", "search", "favorites"];
  const widgetToggles = PLAIN_TYPES.flatMap((type) =>
    instancesOf(type).map((w) => ({ id: w.id, label: widgetLabels[w.id] }))
  );
  const alertTypeLabel: Record<AlertType, string> = {
    generic: "Generic JSON webhook",
    discord: "Discord",
    slack: "Slack",
    ntfy: "ntfy",
  };
  const alertUrlPlaceholder: Record<AlertType, string> = {
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
    integrations,
    updateIntegration,
    addIntegration,
    moveIntegration,
    removeIntegration,
    webhooks,
    updateWebhooks,
    updateWebhookService,
    genWebhookToken,
    toggleWebhookService,
    boards,
    savedBoardIds,
    addBoard,
    updateBoard,
    moveBoard,
    removeBoard,
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
