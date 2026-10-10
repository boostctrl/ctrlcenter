"use client";

import type { InstanceOf } from "@/lib/schema";
import { SelectField, TextField } from "../../ui";
import type { InstanceEditorProps } from "./index";

// An Applications widget's fields in admin Settings → Widgets (#299): its
// title and which apps it shows. Two of them make "Media" and "Infra" cards.
export default function AppsSettings({ w, onChange, groups, tags }: InstanceEditorProps<"apps">) {
  const apps: InstanceOf<"apps"> = w;
  const setFilter = (patch: Partial<InstanceOf<"apps">["filter"]>) =>
    onChange({ filter: { ...apps.filter, ...patch } });
  return (
    <>
      <TextField
        label="Card title"
        placeholder="Applications"
        value={apps.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Group" value={apps.filter.group} onChange={(e) => setFilter({ group: e.target.value })}>
          <option value="">Any group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          {apps.filter.group && !groups.some((g) => g.id === apps.filter.group) && (
            <option value={apps.filter.group}>{apps.filter.group} (gone)</option>
          )}
        </SelectField>
        <SelectField label="Tag" value={apps.filter.tag} onChange={(e) => setFilter({ tag: e.target.value })}>
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
          {apps.filter.tag && !tags.some((t) => t.toLowerCase() === apps.filter.tag.toLowerCase()) && (
            <option value={apps.filter.tag}>#{apps.filter.tag}</option>
          )}
        </SelectField>
        <SelectField
          label="Private apps"
          value={apps.filter.private}
          onChange={(e) =>
            setFilter({ private: e.target.value === "hide" ? "hide" : e.target.value === "only" ? "only" : "any" })
          }
          hint="Only you see private apps, signed in."
        >
          <option value="any">Included</option>
          <option value="hide">Left out</option>
          <option value="only">Only these</option>
        </SelectField>
      </div>
    </>
  );
}
