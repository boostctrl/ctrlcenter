"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Settings } from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import {
  SEARCH_ENGINES,
  SEARCH_ENGINE_KEYS,
  type SearchEngine,
} from "@/lib/search";
import { STATUS_RANGES } from "@/lib/status";
import { supportedTimezones } from "@/lib/prefs";
import { TextField } from "./ui";
import IconField from "./IconField";
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

// Each settings group is its own card; the form lays them out in two explicit
// columns (below) so each section's column placement is deterministic.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass-card flex flex-col gap-4 p-5">
      <h3 className="text-xs font-semibold tracking-[0.15em] text-fg/45 uppercase">
        {title}
      </h3>
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
  // Persistence is automatic: every change debounce-saves via useAutosave.
  const { status, error } = useAutosave(settings, saveSettings);
  const zones = useMemo(() => supportedTimezones(), []);

  const selectClass =
    "accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors";

  const theme = settings.theme;
  const updateTheme = (patch: Partial<Settings["theme"]>) =>
    setSettings((s) => ({ ...s, theme: { ...s.theme, ...patch } }));

  // Apply a theme pack as the site default: record it as the preset and copy its
  // concrete design/scene/colors into the theme fields the layout actually reads.
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
      backgroundLight: pack.light.background,
      foregroundLight: pack.light.foreground,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex h-4 items-center justify-end">
        <SaveStatus status={status} error={error} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* The two columns stretch to equal height (grid's default
            items-stretch) and distribute their sections (lg:justify-between) so
            the tops and bottoms line up. Left: General, Appearance, Security. */}
        <div className="flex flex-col gap-4 lg:justify-between">
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

      <Section title="Appearance">
        <p className="-mt-1 text-xs text-fg/40">
          The site-wide default look visitors see before they customize their own.
          Pick a theme as the default; edit the themes themselves in the{" "}
          <span className="text-fg/60">Themes</span> tab.
        </p>

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

      <Section title="Security">
        <ChangePassword />
      </Section>
        </div>

        {/* Right column — Dashboard, Weather. */}
        <div className="flex flex-col gap-4 lg:justify-between">
      <Section title="Dashboard">
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

        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg/50">Search bar engine</span>
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
        </div>
      </div>
    </div>
  );
}
