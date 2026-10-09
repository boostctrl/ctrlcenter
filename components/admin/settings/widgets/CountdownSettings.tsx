"use client";

import { AddButton, Card, Hint, ListPanel, RemoveButton, TextField, controlClasses } from "../../ui";
import type { SettingsDraft } from "../useSettingsDraft";

// The Countdown card in admin Settings → Widgets (#285).
export default function CountdownSettings({ d }: { d: SettingsDraft }) {
  const { setSettings, countdown, countdownRows, updateCountdownItem } = d;
  return (
    <Card
      title="Countdown"
      intro="Labeled dates shown as “in N days” rows — renewals, birthdays, deadlines. Switch it on to show the card; arrange it in the home-page layout editor."
      toggle={{
        checked: d.isWidgetShown("countdown"),
        onChange: (v) => d.setWidgetShown("countdown", v),
        label: "Show Countdown on the home page",
      }}
    >
      <TextField
        label="Card title"
        placeholder="Countdown"
        value={countdown.title}
        onChange={(e) =>
          setSettings((s) => ({
            ...s,
            countdown: { ...s.countdown, title: e.target.value },
          }))
        }
      />
      <ListPanel label="Dates">
        {countdown.items.map((item, i) => (
          <div
            key={countdownRows.keys[i] ?? i}
            className="flex items-center gap-2"
          >
            <input
              value={item.label}
              onChange={(e) => updateCountdownItem(i, { label: e.target.value })}
              placeholder="Renew domain"
              aria-label={`Countdown ${i + 1} label`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              type="date"
              value={item.date}
              onChange={(e) => updateCountdownItem(i, { date: e.target.value })}
              aria-label={`Countdown ${i + 1} date`}
              className={`${controlClasses} shrink-0`}
            />
            <RemoveButton
              label={`Remove countdown ${i + 1}`}
              onClick={() => countdownRows.removeAt(i)}
            />
          </div>
        ))}
        <AddButton onClick={() => countdownRows.add({ label: "", date: "" })}>
          + Add date
        </AddButton>
      </ListPanel>
      <Hint>
        Days count in each visitor&apos;s own time zone. Past dates dim and
        sink below the upcoming ones.
      </Hint>
    </Card>
  );
}
