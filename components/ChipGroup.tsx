"use client";

import type { ReactNode } from "react";

export type ChipOption<T extends string | number> = {
  value: T;
  label: ReactNode;
};

type ChipSize = "2xs" | "xs" | "sm" | "md" | "lg";

// The padding/text size of each chip. The selected/muted colors and the border
// shell are invariant — only the scale differs between call sites.
const CHIP_SIZE: Record<ChipSize, string> = {
  "2xs": "px-2.5 py-1 text-[10px]",
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-xs",
  lg: "px-4 py-2 text-sm",
};

// The app's segmented single-select toggle: a bordered row of chips where the
// selected one reads bg-fg/15, the rest are muted with a hover, each carrying
// aria-pressed for assistive tech (#116). One component so the dozen call sites
// (status range, appearance mode, check interval, announcement kind, …) can't
// drift in their selected styling or accessibility wiring as they're edited
// apart (#140).
//
// A value that matches no option — only possible where a schema is wider than
// its presets, e.g. a hand-edited config interval — renders through `offLabel`
// as a trailing read-only chip, so the control never reads as "nothing
// selected" (#117). It's a span, not a button: a readout of the current value,
// not a choice, so it isn't a keyboard trap. It vanishes once a preset is picked.
export function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  size = "sm",
  equal = false,
  fit = false,
  shrink = false,
  rounded = "lg",
  capitalize = false,
  offLabel,
}: {
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: ChipSize;
  /** Chips share the row width equally (flex-1). */
  equal?: boolean;
  /** Shrink the row to its content instead of filling its container (w-fit). */
  fit?: boolean;
  /** Keep the row intact next to a flexible sibling (shrink-0). */
  shrink?: boolean;
  rounded?: "md" | "lg";
  capitalize?: boolean;
  offLabel?: (value: T) => ReactNode;
}) {
  const chip = `inline-flex items-center justify-center gap-1.5 transition-colors ${
    CHIP_SIZE[size]
  }${equal ? " flex-1" : ""}${capitalize ? " capitalize" : ""}`;
  const isOff = !options.some((o) => o.value === value);
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex overflow-hidden border border-fg/10 ${
        rounded === "md" ? "rounded-md" : "rounded-lg"
      }${fit ? " w-fit" : ""}${shrink ? " shrink-0" : ""}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${chip} ${
            value === o.value
              ? "bg-fg/15 text-fg"
              : "text-fg/50 hover:text-fg/80"
          }`}
        >
          {o.label}
        </button>
      ))}
      {isOff && offLabel && (
        <span className={`${chip} bg-fg/15 text-fg`}>{offLabel(value)}</span>
      )}
    </div>
  );
}
