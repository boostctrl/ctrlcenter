"use client";

import type { InstanceOf } from "@/lib/schema";
import { SelectField, TextField } from "../../ui";
import type { InstanceEditorProps } from "./index";

// A Bookmarks widget's fields in admin Settings → Widgets (#299): its title,
// and every group or just one.
export default function BookmarksSettings({ w, onChange, groups }: InstanceEditorProps<"bookmarks">) {
  const bookmarks: InstanceOf<"bookmarks"> = w;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="Card title"
        placeholder="Bookmarks"
        value={bookmarks.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <SelectField
        label="Group"
        value={bookmarks.filter.group}
        onChange={(e) => onChange({ filter: { group: e.target.value } })}
      >
        <option value="">Every group</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        {bookmarks.filter.group && !groups.some((g) => g.id === bookmarks.filter.group) && (
          <option value={bookmarks.filter.group}>{bookmarks.filter.group} (gone)</option>
        )}
      </SelectField>
    </div>
  );
}
