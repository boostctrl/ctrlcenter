"use client";

import { MAX_STAT_DISKS } from "@/lib/schema";
import { AddButton, Hint, ListPanel, MoveButtons, RemoveButton, TextField, controlClasses } from "../../ui";
import { useKeyedRows } from "../useKeyedRows";
import type { InstanceEditorProps } from "./index";

type Disk = { label: string; path: string };

// A System stats widget's fields in admin Settings → Widgets (#285, #297).
export default function SystemStatsSettings({ w, label, onChange }: InstanceEditorProps<"systemStats">) {
  const setDisks = (update: (prev: Disk[]) => Disk[]) => onChange({ disks: update(w.disks) });
  const rows = useKeyedRows(w.disks, setDisks);
  const updateDisk = (i: number, patch: Partial<Disk>) =>
    setDisks((disks) => disks.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  return (
    <>
      <TextField
        label="Card title"
        placeholder="System stats"
        value={w.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <ListPanel label="Extra disks">
        {w.disks.map((disk, i) => (
          <div key={rows.keys[i] ?? i} className="flex items-center gap-2">
            {w.disks.length > 1 && (
              <MoveButtons index={i} count={w.disks.length} label={`${label} disk ${i + 1}`} onMove={rows.move} />
            )}
            <input
              value={disk.label}
              onChange={(e) => updateDisk(i, { label: e.target.value })}
              placeholder="Label (optional)"
              aria-label={`${label} disk ${i + 1} label`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              value={disk.path}
              onChange={(e) => updateDisk(i, { path: e.target.value })}
              placeholder="/mnt/media"
              aria-label={`${label} disk ${i + 1} path`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <RemoveButton label={`Remove ${label} disk ${i + 1}`} onClick={() => rows.removeAt(i)} />
          </div>
        ))}
        {w.disks.length < MAX_STAT_DISKS && (
          <AddButton onClick={() => rows.add({ label: "", path: "" })}>+ Add disk</AddButton>
        )}
      </ListPanel>
      <Hint>
        The data volume is always shown. A path here has to be mounted into
        the app&apos;s container to be measurable; a path that isn&apos;t is
        simply skipped. Leave the label blank and the card shows the
        folder&apos;s name, never the full mount path.
      </Hint>
    </>
  );
}
