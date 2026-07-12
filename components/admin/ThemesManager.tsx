"use client";

import { useState } from "react";
import {
  DESIGNS,
  SCENES,
  THEME_PACKS,
  DEFAULT_THEME_NAME,
  type ColorSet,
  type DesignId,
  type SceneId,
  type ThemePack,
} from "@/lib/theme";
import type { ThemePackConfig } from "@/lib/schema";
import { ChipGroup } from "@/components/ChipGroup";
import { apiErrorMessage } from "./apiError";
import { useConfirm } from "./Confirm";
import { useAutosave, SaveStatus, type SaveOptions } from "./useAutosave";

async function saveThemes(
  overrides: Record<string, ThemePackConfig>,
  opts?: SaveOptions
): Promise<void> {
  const res = await fetch("/api/themes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.values(overrides)),
    keepalive: opts?.keepalive,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Failed to save themes"));
  }
}

const selectClass =
  "accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg outline-none transition-colors";
const colorClass =
  "h-8 w-8 shrink-0 cursor-pointer rounded border border-fg/10 bg-transparent";

const COLOR_FIELDS: { key: keyof ColorSet; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
  { key: "accentFrom", label: "Accent start" },
  { key: "accentTo", label: "Accent end" },
];

function builtin(name: string): ThemePack {
  return THEME_PACKS.find((p) => p.name === name)!;
}

export default function ThemesManager({
  initialOverrides,
}: {
  initialOverrides: ThemePackConfig[];
}) {
  // Overrides keyed by the built-in's stable `key` (its original name), so the
  // editable display `name` can differ. Normalize legacy key-less overrides.
  const [overrides, setOverrides] = useState<Record<string, ThemePackConfig>>(
    () =>
      Object.fromEntries(
        initialOverrides.map((o) => {
          const key = o.key ?? o.name;
          return [key, { ...o, key }];
        })
      )
  );
  // Edits debounce-save automatically (local state stays authoritative).
  const { status, error } = useAutosave(overrides, saveThemes);
  const confirm = useConfirm();

  // Seed an override for `slot` (a built-in name) from its current value, so a
  // partial edit keeps the other fields and always carries the stable key.
  function setPack(slot: string, patch: Partial<ThemePackConfig>) {
    setOverrides((o) => {
      const base = o[slot] ?? { ...builtin(slot), key: slot };
      return { ...o, [slot]: { ...base, ...patch } };
    });
  }

  function setColor(
    slot: string,
    mode: "dark" | "light",
    key: keyof ColorSet,
    value: string
  ) {
    setOverrides((o) => {
      const base = o[slot] ?? { ...builtin(slot), key: slot };
      return {
        ...o,
        [slot]: { ...base, [mode]: { ...base[mode], [key]: value } },
      };
    });
  }

  // Confirmed: discards every customization of the pack at once, with no undo
  // (aligned with the visitor-side destructive actions, #121).
  async function resetPack(slot: string, displayName: string) {
    const ok = await confirm({
      title: `Reset “${displayName}”?`,
      message: "Restores the built-in theme, discarding your edits to it.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!ok) return;
    setOverrides((o) => {
      const next = { ...o };
      delete next[slot];
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-fg/50">
          Edit the built-in themes visitors can pick in the theme builder. Rename
          a theme, recolor it, or change its design and scene; changes apply
          site-wide. Reset any theme to restore its original.
        </p>
        <SaveStatus status={status} error={error} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {THEME_PACKS.map((p) => (
          <PackEditor
            key={p.name}
            pack={overrides[p.name] ?? p}
            isDefault={p.name === DEFAULT_THEME_NAME}
            edited={p.name in overrides}
            onField={(patch) => setPack(p.name, patch)}
            onColor={(mode, key, value) => setColor(p.name, mode, key, value)}
            onReset={() => resetPack(p.name, (overrides[p.name] ?? p).name)}
          />
        ))}
      </div>
    </div>
  );
}

function PackEditor({
  pack,
  isDefault,
  edited,
  onField,
  onColor,
  onReset,
}: {
  pack: ThemePack;
  isDefault: boolean;
  edited: boolean;
  onField: (patch: Partial<ThemePackConfig>) => void;
  onColor: (mode: "dark" | "light", key: keyof ColorSet, value: string) => void;
  onReset: () => void;
}) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const cs = pack[mode];
  return (
    <div className="glass-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={pack.name}
            onChange={(e) => onField({ name: e.target.value })}
            aria-label="Theme name"
            className="accent-focus min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-semibold text-fg outline-none transition-colors hover:border-fg/15 focus:border-fg/25 focus:bg-fg/5"
          />
          {isDefault && (
            <span className="shrink-0 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-fg/70 uppercase">
              Default
            </span>
          )}
          {edited && <span className="shrink-0 text-xs text-fg/40">· edited</span>}
        </div>
        {edited && (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-fg/50 transition-colors hover:bg-fg/10 hover:text-fg/80"
          >
            Reset
          </button>
        )}
      </div>

      {/* Live preview of the current mode's surface + accent. */}
      <div
        className="h-10 w-full rounded-lg ring-1 ring-fg/10"
        style={{
          background: `radial-gradient(120% 100% at 50% -10%, ${cs.accentFrom}, transparent 60%), ${cs.background}`,
        }}
        aria-hidden
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg/50">Design</span>
          <select
            value={pack.design}
            onChange={(e) => onField({ design: e.target.value as DesignId })}
            className={selectClass}
          >
            {DESIGNS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg/50">Scene</span>
          <select
            value={pack.scene}
            onChange={(e) => onField({ scene: e.target.value as SceneId })}
            className={selectClass}
          >
            {SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ChipGroup
        label="Editing mode"
        equal
        capitalize
        options={(["dark", "light"] as const).map((m) => ({
          value: m,
          label: m,
        }))}
        value={mode}
        onChange={setMode}
      />

      <div className="grid grid-cols-2 gap-2">
        {COLOR_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-xs">
            <input
              type="color"
              value={cs[f.key]}
              onChange={(e) => onColor(mode, f.key, e.target.value)}
              aria-label={`${pack.name} ${mode} ${f.label}`}
              className={colorClass}
            />
            <span className="text-fg/60">{f.label}</span>
          </label>
        ))}
      </div>

      {/* Accent gradient preview for the current mode. */}
      <div
        className="h-6 w-full rounded-lg ring-1 ring-fg/10"
        style={{
          backgroundImage: `linear-gradient(135deg, ${cs.accentFrom}, ${cs.accentTo})`,
        }}
        aria-hidden
      />
    </div>
  );
}
