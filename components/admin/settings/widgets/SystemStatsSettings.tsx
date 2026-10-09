"use client";

import { MAX_STAT_DISKS } from "@/lib/schema";
import { AddButton, Card, Hint, ListPanel, MoveButtons, RemoveButton, TextField, controlClasses } from "../../ui";
import type { SettingsDraft } from "../useSettingsDraft";

// The System stats card in admin Settings → Widgets (#285).
export default function SystemStatsSettings({ d }: { d: SettingsDraft }) {
  const { setSettings, systemStats, statDiskRows, updateStatDisk } = d;
  return (
    <Card
      title="System stats"
      intro="CPU, memory and disk usage of whatever runs the app. Switch it on to show the card; arrange it in the home-page layout editor. The card itself says whether it's measuring this container or the host machine."
      toggle={{
        checked: d.isWidgetShown("systemStats"),
        onChange: (v) => d.setWidgetShown("systemStats", v),
        label: "Show System stats on the home page",
      }}
    >
      <TextField
        label="Card title"
        placeholder="System stats"
        value={systemStats.title}
        onChange={(e) =>
          setSettings((s) => ({
            ...s,
            systemStats: { ...s.systemStats, title: e.target.value },
          }))
        }
      />
      <ListPanel label="Extra disks">
        {systemStats.disks.map((disk, i) => (
          <div
            key={statDiskRows.keys[i] ?? i}
            className="flex items-center gap-2"
          >
            {systemStats.disks.length > 1 && (
              <MoveButtons
                index={i}
                count={systemStats.disks.length}
                label={`disk ${i + 1}`}
                onMove={statDiskRows.move}
              />
            )}
            <input
              value={disk.label}
              onChange={(e) => updateStatDisk(i, { label: e.target.value })}
              placeholder="Label (optional)"
              aria-label={`Disk ${i + 1} label`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              value={disk.path}
              onChange={(e) => updateStatDisk(i, { path: e.target.value })}
              placeholder="/mnt/media"
              aria-label={`Disk ${i + 1} path`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <RemoveButton
              label={`Remove disk ${i + 1}`}
              onClick={() => statDiskRows.removeAt(i)}
            />
          </div>
        ))}
        {systemStats.disks.length < MAX_STAT_DISKS && (
          <AddButton onClick={() => statDiskRows.add({ label: "", path: "" })}>
            + Add disk
          </AddButton>
        )}
      </ListPanel>
      <Hint>
        The data volume is always shown. A path here has to be mounted into
        the app&apos;s container to be measurable; a path that isn&apos;t is
        simply skipped. Leave the label blank and the card shows the
        folder&apos;s name, never the full mount path.
      </Hint>
    </Card>
  );
}
