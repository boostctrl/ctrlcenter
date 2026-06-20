"use client";

import { useState, type FormEvent } from "react";
import type { Settings } from "@/lib/schema";
import { ACCENTS, ACCENT_KEYS } from "@/lib/theme";
import {
  SEARCH_ENGINES,
  SEARCH_ENGINE_KEYS,
  type SearchEngine,
} from "@/lib/search";
import { TextField, Button } from "./ui";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";

export default function SettingsManager({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

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

  return (
    <form onSubmit={handleSubmit} className="glass-card flex max-w-xl flex-col gap-4 p-6">
      <TextField
        label="Page title"
        value={settings.title}
        onChange={(e) => setSettings({ ...settings, title: e.target.value })}
      />
      <TextField
        label="Greeting name (optional)"
        placeholder="e.g. Eric"
        value={settings.greetingName}
        onChange={(e) => setSettings({ ...settings, greetingName: e.target.value })}
      />
      <TextField
        label="Timezone (IANA, e.g. America/Chicago)"
        value={settings.timezone}
        onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
      />

      <div className="flex flex-col gap-2">
        <span className="text-sm text-white/50">Accent</span>
        <div className="flex flex-wrap gap-2">
          {ACCENT_KEYS.map((key) => {
            const { from, to } = ACCENTS[key];
            const selected = settings.accent === key;
            return (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={selected}
                title={key}
                onClick={() => setSettings({ ...settings, accent: key })}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-[#06070d] transition ${
                  selected ? "ring-white/80" : "ring-transparent hover:ring-white/30"
                }`}
                style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
              />
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4">
        <div>
          <span className="text-sm text-white/70">Service status indicators</span>
          <p className="text-xs text-white/40">
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

      <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
        <span className="text-sm text-white/50">Search bar engine</span>
        <select
          value={settings.search.engine}
          onChange={(e) =>
            setSettings({
              ...settings,
              search: { ...settings.search, engine: e.target.value as SearchEngine },
            })
          }
          className="accent-focus rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition-colors"
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
        <p className="text-xs text-white/40">
          Pressing Enter in the search bar opens the top match, or searches here
          when nothing matches.
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-sm text-white/50">Weather widget</span>
        <label className="flex items-center gap-2 text-sm">
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
        <span className="text-white/50">Units</span>
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
          className="accent-focus rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition-colors"
        >
          <option value="imperial">Imperial (°F)</option>
          <option value="metric">Metric (°C)</option>
        </select>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
