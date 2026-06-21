"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Settings } from "@/lib/schema";
import { DESIGNS, SCENES, type DesignId, type SceneId } from "@/lib/theme";
import {
  SEARCH_ENGINES,
  SEARCH_ENGINE_KEYS,
  type SearchEngine,
} from "@/lib/search";
import { supportedTimezones } from "@/lib/prefs";
import { TextField, Button } from "./ui";
import IconField from "./IconField";
import CitySearch from "./CitySearch";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-fg/10 pt-5 first:border-0 first:pt-0">
      <h3 className="text-xs font-semibold tracking-[0.15em] text-fg/40 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function SettingsManager({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const zones = useMemo(() => supportedTimezones(), []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to save settings"), "error");
        return;
      }
      const data: Settings = await res.json();
      setSettings(data);
      toast("Settings saved");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    "accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors";
  const colorClass =
    "h-8 w-8 shrink-0 cursor-pointer rounded border border-fg/10 bg-transparent";

  const theme = settings.theme;
  const updateTheme = (patch: Partial<Settings["theme"]>) =>
    setSettings((s) => ({ ...s, theme: { ...s.theme, ...patch } }));
  const customColors = Boolean(theme.background && theme.foreground);
  // Which mode's custom default colors the pickers below edit (the accent is
  // shared across both). Dark = background/foreground; light = the *Light pair.
  const [colorMode, setColorMode] = useState<"dark" | "light">("dark");
  const bgKey = colorMode === "light" ? "backgroundLight" : "background";
  const fgKey = colorMode === "light" ? "foregroundLight" : "foreground";
  const bgFallback = colorMode === "light" ? "#eceef3" : "#06070d";
  const fgFallback = colorMode === "light" ? "#181b24" : "#f4f4f6";

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-card flex max-w-3xl flex-col gap-6 p-6"
    >
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
          The site-wide default theme. Visitors can override any of this in their
          own browser from the settings page.
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
          <span className="text-fg/50">Default design</span>
          <select
            value={theme.design}
            onChange={(e) =>
              updateTheme({ design: e.target.value as DesignId })
            }
            className={selectClass}
          >
            {DESIGNS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.description}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg/50">Default scene</span>
          <select
            value={theme.scene}
            onChange={(e) =>
              updateTheme({ scene: e.target.value as SceneId })
            }
            className={selectClass}
          >
            {SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.description}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg/50">Default accent</span>
          <div
            className="h-8 w-full rounded-lg ring-1 ring-fg/10"
            style={{
              backgroundImage: `linear-gradient(to right, ${theme.accentFrom}, ${theme.accentTo})`,
            }}
            aria-hidden
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={theme.accentFrom}
                onChange={(e) => updateTheme({ accentFrom: e.target.value })}
                aria-label="Accent start"
                className={colorClass}
              />
              <span className="text-fg/60">Start</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={theme.accentTo}
                onChange={(e) => updateTheme({ accentTo: e.target.value })}
                aria-label="Accent end"
                className={colorClass}
              />
              <span className="text-fg/60">End</span>
            </label>
          </div>
          <p className="text-xs text-fg/40">
            Set both ends to the same color for a solid accent.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="text-fg/70">Custom default colors</span>
              <span className="block text-xs text-fg/40">
                Override the light/dark background and text with fixed colors.
              </span>
            </span>
            <input
              type="checkbox"
              checked={customColors}
              onChange={(e) =>
                updateTheme(
                  e.target.checked
                    ? {
                        background: theme.background ?? "#06070d",
                        foreground: theme.foreground ?? "#f4f4f6",
                        backgroundLight: theme.backgroundLight ?? "#eceef3",
                        foregroundLight: theme.foregroundLight ?? "#181b24",
                      }
                    : {
                        background: undefined,
                        foreground: undefined,
                        backgroundLight: undefined,
                        foregroundLight: undefined,
                      }
                )
              }
            />
          </label>
          {customColors && (
            <>
              {/* Live preview chips: each shows that mode's surface + text, so
                  both pairs are visible at a glance and it's clear which one the
                  pickers below edit. */}
              <div className="grid grid-cols-2 gap-2">
                {(["dark", "light"] as const).map((m) => {
                  const bg =
                    m === "light"
                      ? theme.backgroundLight ?? "#eceef3"
                      : theme.background ?? "#06070d";
                  const fg =
                    m === "light"
                      ? theme.foregroundLight ?? "#181b24"
                      : theme.foreground ?? "#f4f4f6";
                  const selected = colorMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setColorMode(m)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors ${
                        selected
                          ? "border-fg/40"
                          : "border-fg/10 hover:border-fg/25"
                      }`}
                    >
                      <span
                        className="flex h-8 w-10 items-center justify-center rounded-md ring-1 ring-fg/10"
                        style={{ background: bg, color: fg }}
                      >
                        <span className="text-xs font-semibold">Aa</span>
                      </span>
                      <span
                        className={`text-xs capitalize ${
                          selected ? "text-fg/90" : "text-fg/55"
                        }`}
                      >
                        {m}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="color"
                    value={theme[bgKey] ?? bgFallback}
                    onChange={(e) => updateTheme({ [bgKey]: e.target.value })}
                    aria-label={`${colorMode} background`}
                    className={colorClass}
                  />
                  <span className="text-fg/60">Background</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="color"
                    value={theme[fgKey] ?? fgFallback}
                    onChange={(e) => updateTheme({ [fgKey]: e.target.value })}
                    aria-label={`${colorMode} text & surfaces`}
                    className={colorClass}
                  />
                  <span className="text-fg/60">Text &amp; surfaces</span>
                </label>
              </div>
              <p className="text-xs text-fg/40">
                Editing the <span className="text-fg/60">{colorMode}</span> pair —
                the accent above is shared across both.
              </p>
            </>
          )}
        </div>
      </Section>

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

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
