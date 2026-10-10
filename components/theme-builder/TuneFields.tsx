"use client";

import { DEFAULT_TUNE, TUNE_FIELDS, isDefaultTune, type Tune, type TuneKey } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";

// The six fine-tune sliders (#326), shared by the theme builder's Tune tab and
// the admin pack editor. `value` null means the design untouched (every knob
// at 100%); a change always yields a full Tune, and a tune back at all-100 is
// reported as null so nothing is stored for "untouched".
export function TuneFields({
  value,
  onChange,
  idPrefix,
  compact = false,
}: {
  value: Tune | null;
  onChange: (tune: Tune | null) => void;
  idPrefix: string;
  compact?: boolean;
}) {
  const tune = value ?? DEFAULT_TUNE;
  const set = (key: TuneKey, v: number) => {
    const next = { ...tune, [key]: v };
    onChange(isDefaultTune(next) ? null : next);
  };
  return (
    <div className={compact ? "space-y-2" : "grid gap-x-6 gap-y-3 sm:grid-cols-2"}>
      {TUNE_FIELDS.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        return (
          <div key={f.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={id} className={compact ? "text-xs text-ink-60" : "text-[11px] font-medium text-ink-55"}>
                {f.label}
              </label>
              <output htmlFor={id} className="font-mono text-[10px] text-ink-40 tabular-nums">
                {tune[f.key]}%
              </output>
            </div>
            <input
              id={id}
              type="range"
              min={0}
              max={f.max}
              step={5}
              value={tune[f.key]}
              onChange={(e) => set(f.key, Number(e.target.value))}
              aria-describedby={compact ? undefined : `${id}-desc`}
              className="tune-range w-full"
            />
            {!compact && (
              <p id={`${id}-desc`} className="text-[10px] text-ink-40">
                {f.description}
              </p>
            )}
          </div>
        );
      })}
      {value && (
        <div className={compact ? "" : "sm:col-span-2"}>
          <button type="button" onClick={() => onChange(null)} className={buttonClasses("ghost", "sm")}>
            Reset to the design
          </button>
        </div>
      )}
    </div>
  );
}
