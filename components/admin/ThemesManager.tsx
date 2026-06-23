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
import { Button } from "./ui";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";

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
  const toast = useToast();
  const [overrides, setOverrides] = useState<Record<string, ThemePack>>(() =>
    Object.fromEntries(initialOverrides.map((o) => [o.name, o]))
  );
  const [saving, setSaving] = useState(false);

  function setPack(name: string, patch: Partial<ThemePack>) {
    setOverrides((o) => {
      const base = o[name] ?? builtin(name);
      return { ...o, [name]: { ...base, ...patch } };
    });
  }

  function setColor(
    name: string,
    mode: "dark" | "light",
    key: keyof ColorSet,
    value: string
  ) {
    setOverrides((o) => {
      const base = o[name] ?? builtin(name);
      return {
        ...o,
        [name]: { ...base, [mode]: { ...base[mode], [key]: value } },
      };
    });
  }

  function reset(name: string) {
    setOverrides((o) => {
      const next = { ...o };
      delete next[name];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/themes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.values(overrides)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to save themes"), "error");
        return;
      }
      const saved: ThemePackConfig[] = await res.json();
      setOverrides(Object.fromEntries(saved.map((o) => [o.name, o])));
      toast("Themes saved");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-fg/50">
          Edit the built-in themes visitors can pick in the theme builder. Recolor
          a theme or change its design and scene; changes apply site-wide. Reset
          any theme to restore its original.
        </p>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save themes"}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {THEME_PACKS.map((p) => (
          <PackEditor
            key={p.name}
            pack={overrides[p.name] ?? p}
            edited={p.name in overrides}
            onField={(patch) => setPack(p.name, patch)}
            onColor={(mode, key, value) => setColor(p.name, mode, key, value)}
            onReset={() => reset(p.name)}
          />
        ))}
      </div>
    </div>
  );
}

function PackEditor({
  pack,
  edited,
  onField,
  onColor,
  onReset,
}: {
  pack: ThemePack;
  edited: boolean;
  onField: (patch: Partial<ThemePack>) => void;
  onColor: (mode: "dark" | "light", key: keyof ColorSet, value: string) => void;
  onReset: () => void;
}) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const cs = pack[mode];
  return (
    <div className="glass-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{pack.name}</span>
          {pack.name === DEFAULT_THEME_NAME && (
            <span className="rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-fg/70 uppercase">
              Default
            </span>
          )}
          {edited && <span className="text-xs text-fg/40">· edited</span>}
        </div>
        {edited && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md px-2 py-1 text-xs text-fg/50 transition-colors hover:bg-fg/10 hover:text-fg/80"
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

      <div className="flex overflow-hidden rounded-lg border border-fg/10 text-xs">
        {(["dark", "light"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`flex-1 px-2 py-1.5 capitalize transition-colors ${
              mode === m ? "bg-fg/15 text-fg" : "text-fg/50 hover:text-fg/80"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

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
    </div>
  );
}
