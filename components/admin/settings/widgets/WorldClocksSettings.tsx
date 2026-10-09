"use client";

import { AddButton, Card, Hint, ListPanel, MoveButtons, RemoveButton, TextField, controlClasses } from "../../ui";
import type { SettingsDraft } from "../useSettingsDraft";

// The World clocks card in admin Settings → Widgets (#285).
export default function WorldClocksSettings({ d }: { d: SettingsDraft }) {
  const { setSettings, worldClocks, worldClockRows, updateWorldClockItem } = d;
  return (
    <Card
      title="World clocks"
      intro="Live clocks for the time zones you follow. Switch it on to show the card; arrange it in the home-page layout editor."
      toggle={{
        checked: d.isWidgetShown("worldClocks"),
        onChange: (v) => d.setWidgetShown("worldClocks", v),
        label: "Show World clocks on the home page",
      }}
    >
      <TextField
        label="Card title"
        placeholder="World clocks"
        value={worldClocks.title}
        onChange={(e) =>
          setSettings((s) => ({
            ...s,
            worldClocks: { ...s.worldClocks, title: e.target.value },
          }))
        }
      />
      <ListPanel label="Time zones">
        {worldClocks.items.map((item, i) => (
          <div
            key={worldClockRows.keys[i] ?? i}
            className="flex items-center gap-2"
          >
            {worldClocks.items.length > 1 && (
              <MoveButtons
                index={i}
                count={worldClocks.items.length}
                label={`world clock ${i + 1}`}
                onMove={worldClockRows.move}
              />
            )}
            <input
              value={item.label}
              onChange={(e) => updateWorldClockItem(i, { label: e.target.value })}
              placeholder="Label (optional)"
              aria-label={`World clock ${i + 1} label`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              list="settings-tz"
              value={item.timeZone}
              onChange={(e) => updateWorldClockItem(i, { timeZone: e.target.value })}
              placeholder="Time zone…"
              aria-label={`World clock ${i + 1} time zone`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <RemoveButton
              label={`Remove world clock ${i + 1}`}
              onClick={() => worldClockRows.removeAt(i)}
            />
          </div>
        ))}
        <AddButton
          onClick={() => worldClockRows.add({ label: "", timeZone: "" })}
        >
          + Add time zone
        </AddButton>
      </ListPanel>
      <Hint>
        Each clock shows the current time in its own zone. Leave the label
        blank to use the zone&apos;s city name.
      </Hint>
    </Card>
  );
}
