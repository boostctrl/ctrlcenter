"use client";

import { AddButton, Hint, ListPanel, RemoveButton, TextField, controlClasses } from "../../ui";
import { useKeyedRows } from "../useKeyedRows";
import type { InstanceEditorProps } from "./index";

type Item = { label: string; date: string };

// A Countdown widget's fields in admin Settings → Widgets (#285, #297).
export default function CountdownSettings({ w, label, onChange }: InstanceEditorProps<"countdown">) {
  const setItems = (update: (prev: Item[]) => Item[]) => onChange({ items: update(w.items) });
  const rows = useKeyedRows(w.items, setItems);
  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems((items) => items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  return (
    <>
      <TextField
        label="Card title"
        placeholder="Countdown"
        value={w.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <ListPanel label="Dates">
        {w.items.map((item, i) => (
          <div key={rows.keys[i] ?? i} className="flex items-center gap-2">
            <input
              value={item.label}
              onChange={(e) => updateItem(i, { label: e.target.value })}
              placeholder="Renew domain"
              aria-label={`${label} date ${i + 1} label`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              type="date"
              value={item.date}
              onChange={(e) => updateItem(i, { date: e.target.value })}
              aria-label={`${label} date ${i + 1}`}
              className={`${controlClasses} shrink-0`}
            />
            <RemoveButton label={`Remove ${label} date ${i + 1}`} onClick={() => rows.removeAt(i)} />
          </div>
        ))}
        <AddButton onClick={() => rows.add({ label: "", date: "" })}>+ Add date</AddButton>
      </ListPanel>
      <Hint>
        Days count in each visitor&apos;s own time zone. Past dates dim and
        sink below the upcoming ones.
      </Hint>
    </>
  );
}
