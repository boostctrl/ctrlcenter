"use client";

import { Card, Hint, NumberField, SelectField, fieldLabelClasses } from "../../ui";
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

      {/* Bounded like the settings PUT (weatherUpdateSchema), so a coordinate
          the server would reject can't be saved in the first place. */}
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Latitude"
          decimal
          min={-90}
          max={90}
          value={settings.weather.latitude}
          onChange={(latitude) =>
            setSettings({ ...settings, weather: { ...settings.weather, latitude } })
          }
        />
        <NumberField
          label="Longitude"
          decimal
          min={-180}
          max={180}
          value={settings.weather.longitude}
          onChange={(longitude) =>
            setSettings({ ...settings, weather: { ...settings.weather, longitude } })
          }
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
