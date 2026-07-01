"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Settings } from "@/lib/schema";
import { ALERT_TYPES } from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import {
  SEARCH_ENGINES,
  SEARCH_ENGINE_KEYS,
  type SearchEngine,
} from "@/lib/search";
import { STATUS_RANGES } from "@/lib/status";
import { supportedTimezones } from "@/lib/prefs";
import {
  resolveLayoutSections,
  SECTION_LABELS,
  SECTION_WIDTHS,
  WIDTH_LABELS,
  type LayoutSection,
  type LayoutSectionId,
  type SectionWidth,
} from "@/lib/layout";
import { TextField, MoveButtons } from "./ui";
import { reorder } from "./useReorder";
import IconField from "./IconField";
import CalendarTest from "./CalendarTest";
import CitySearch from "./CitySearch";
import ChangePassword from "./ChangePassword";
import { apiErrorMessage } from "./apiError";
import { useAutosave, SaveStatus } from "./useAutosave";

async function saveSettings(settings: Settings): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Failed to save settings"));
  }
}

// One nav entry per settings group; a single group shows at a time.
const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "layout", label: "Layout" },
  { id: "search", label: "Search" },
  { id: "status", label: "Status" },
  { id: "alerts", label: "Alerts" },
  { id: "weather", label: "Weather" },
  { id: "calendar", label: "Calendar" },
  { id: "security", label: "Security" },
] as const;
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

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
    <section className="glass-card flex flex-col gap-4 p-5">
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
  const [settings, setSettings] = useState(initialSettings);
  const [section, setSection] = useState<SettingsSectionId>("general");
  // Persistence is automatic: every change debounce-saves via useAutosave.
  const { status, error } = useAutosave(settings, saveSettings);
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

  // Home-page section arrangement (order + width). Always resolved so every
  // section shows even if the saved layout is partial; the admin sends the whole
  // list back (updateSettings replaces it wholesale).
  const layoutSections = resolveLayoutSections(settings.layout.sections);
  const setLayout = (next: LayoutSection[]) =>
    setSettings((s) => ({ ...s, layout: { sections: next } }));
  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= layoutSections.length) return;
    setLayout(reorder(layoutSections, from, to));
  };
  const setSectionWidth = (id: LayoutSectionId, width: SectionWidth) =>
    setLayout(layoutSections.map((s) => (s.id === id ? { ...s, width } : s)));
  // Components without their own dedicated toggle (weather/status/calendar keep
  // theirs). Order mirrors roughly top-to-bottom on the page.
  const componentToggles: { key: keyof Settings["components"]; label: string }[] = [
    { key: "greeting", label: "Greeting" },
    { key: "clock", label: "Date & clock" },
    { key: "search", label: "Search bar" },
    { key: "apps", label: "Applications" },
    { key: "bookmarks", label: "Bookmarks" },
    { key: "favorites", label: "Favorites row" },
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
    // sticky vertical rail on lg+) beside a single focused section, so any
    // setting is one click away instead of somewhere down a masonry flow.
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[11rem_minmax(0,42rem)] lg:gap-x-8">
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

        {section === "appearance" && (
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
          title="Layout"
          intro="Show or hide individual home-page components. Weather, the status row, and the calendar are toggled in their own sections."
        >
        <div className="flex flex-col gap-2.5">
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

        <div className="mt-2 border-t border-fg/10 pt-4">
          <span className="text-sm text-fg/70">Arrangement</span>
          <p className="mt-1 mb-3 text-xs text-fg/40">
            Order the dashboard sections and set each to full, two-thirds, half,
            or a third of the width. Sections whose widths fit a row sit side by
            side. Hidden sections don&apos;t appear regardless of order.
          </p>
          <ul className="flex flex-col gap-2">
            {layoutSections.map((s, i) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm"
              >
                <MoveButtons
                  index={i}
                  count={layoutSections.length}
                  label={SECTION_LABELS[s.id]}
                  onMove={moveSection}
                />
                <span className="flex-1 text-fg/80">{SECTION_LABELS[s.id]}</span>
                <div className="flex shrink-0 overflow-hidden rounded-lg border border-fg/10">
                  {SECTION_WIDTHS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setSectionWidth(s.id, w)}
                      title={w === "twoThirds" ? "Two-thirds" : w === "third" ? "One-third" : w === "half" ? "Half" : "Full"}
                      className={`px-2.5 py-1 text-xs transition-colors ${
                        s.width === w
                          ? "bg-fg/15 text-fg"
                          : "text-fg/50 hover:text-fg/80"
                      }`}
                    >
                      {WIDTH_LABELS[w]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
        </Section>
        )}

        {section === "status" && (
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
              {([1, 5, 15] as const).map((m) => (
                <button
                  key={m}
                  type="button"
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
        <Section title="Search">
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

        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg/50">Custom search bangs</span>
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

        {section === "alerts" && (
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
          </>
        )}
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

        {section === "calendar" && (
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
  );
}
