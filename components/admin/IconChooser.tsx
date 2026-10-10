"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import IconPicker from "./IconPicker";

// A compact icon control for a list row (boards and groups, #316): a square
// showing the icon, or a + when there's none, that opens the icon picker —
// the library, your uploads, an image address, or No icon. IconField is the
// roomier form-field version.
export default function IconChooser({
  value,
  onChange,
  label,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  // What the control is for, e.g. "Icon for the Media board".
  label: string;
  // For the fallback letter while an icon loads or fails.
  name: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${value || "none"}`}
        title={value || "Choose an icon"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fg/5 ring-1 ring-fg/10 transition-colors hover:bg-fg/10"
      >
        {value ? (
          <Icon icon={value} name={name || "?"} size={22} />
        ) : (
          <span aria-hidden className="text-lg leading-none text-ink-45">
            +
          </span>
        )}
      </button>
      {open && (
        <IconPicker
          onPick={onChange}
          onClose={() => setOpen(false)}
          onClear={value ? () => onChange("") : undefined}
        />
      )}
    </>
  );
}
