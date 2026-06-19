"use client";

import { useState, type FormEvent } from "react";
import type { Settings } from "@/lib/schema";
import { TextField, Button } from "./ui";

export default function SettingsManager({
  initialSettings,
}: {
  initialSettings: Settings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          err?.error ? JSON.stringify(err.error) : "Failed to save settings"
        );
      }
      const data: Settings = await res.json();
      setSettings(data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
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
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition-colors focus:border-violet-400/60"
        >
          <option value="imperial">Imperial (°F)</option>
          <option value="metric">Metric (°C)</option>
        </select>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          Save settings
        </Button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}
