"use client";

import { Card, Hint, SelectField, TextField, fieldLabelClasses } from "../../ui";
import CitySearch from "../../CitySearch";
import type { SettingsDraft } from "../useSettingsDraft";

// The Weather card in admin Settings → Widgets (#285).
export default function WeatherSettings({ d }: { d: SettingsDraft }) {
  const { settings, setSettings } = d;
  return (
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
  );
}
