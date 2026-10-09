"use client";

import { AddButton, Hint, ListPanel, MoveButtons, RemoveButton, TextField, controlClasses } from "../../ui";
import { useKeyedRows } from "../useKeyedRows";
import type { InstanceEditorProps } from "./index";

type Item = { label: string; timeZone: string };

// A World clocks widget's fields in admin Settings → Widgets (#285, #297).
export default function WorldClocksSettings({ w, label, onChange }: InstanceEditorProps<"worldClocks">) {
  const setItems = (update: (prev: Item[]) => Item[]) => onChange({ items: update(w.items) });
  const rows = useKeyedRows(w.items, setItems);
  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems((items) => items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  return (
    <>
      <TextField
        label="Card title"
        placeholder="World clocks"
        value={w.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <ListPanel label="Time zones">
        {w.items.map((item, i) => (
          <div key={rows.keys[i] ?? i} className="flex items-center gap-2">
            {w.items.length > 1 && (
              <MoveButtons
                index={i}
                count={w.items.length}
                label={`${label} clock ${i + 1}`}
                onMove={rows.move}
              />
            )}
            <input
              value={item.label}
              onChange={(e) => updateItem(i, { label: e.target.value })}
              placeholder="Label (optional)"
              aria-label={`${label} clock ${i + 1} label`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              list="settings-tz"
              value={item.timeZone}
              onChange={(e) => updateItem(i, { timeZone: e.target.value })}
              placeholder="Time zone…"
              aria-label={`${label} clock ${i + 1} time zone`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <RemoveButton label={`Remove ${label} clock ${i + 1}`} onClick={() => rows.removeAt(i)} />
          </div>
        ))}
        <AddButton onClick={() => rows.add({ label: "", timeZone: "" })}>+ Add time zone</AddButton>
      </ListPanel>
      <Hint>
        Each clock shows the current time in its own zone. Leave the label
        blank to use the zone&apos;s city name.
      </Hint>
    </>
  );
}
