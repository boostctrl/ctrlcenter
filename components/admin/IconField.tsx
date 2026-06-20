"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { TextField } from "./ui";
import IconPicker from "./IconPicker";

// Icon input with a live preview and a "Browse" button that opens the searchable
// icon picker. Shared by the apps and bookmarks forms.
export default function IconField({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  name: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <TextField
            label="Icon (slug or image URL)"
            placeholder="e.g. nextcloud"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fg/5 ring-1 ring-fg/10">
          <Icon icon={value} name={name || "?"} size={22} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-fg/50 underline transition-colors hover:text-fg/80"
      >
        Browse icons
      </button>
      {open && (
        <IconPicker onPick={onChange} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
