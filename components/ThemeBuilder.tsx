"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import type { ThemeColors } from "@/lib/prefs";

const DEFAULT_DRAFT: ThemeColors = {
  background: "#06070d",
  foreground: "#f4f4f6",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

const FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
  { key: "accentFrom", label: "Accent start" },
  { key: "accentTo", label: "Accent end" },
];

function readVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

export default function ThemeBuilder() {
  const {
    customThemes,
    activeColors,
    setCustomColors,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    clearCustomTheme,
  } = useVisitorPrefs();

  const [draft, setDraft] = useState<ThemeColors>(DEFAULT_DRAFT);
  const [name, setName] = useState("");

  // Seed the pickers from the active custom theme, or the current mode's colors.
  useEffect(() => {
    const seed = activeColors ?? {
      background: readVar("--background", DEFAULT_DRAFT.background),
      foreground: readVar("--foreground", DEFAULT_DRAFT.foreground),
      accentFrom: readVar("--accent-from", DEFAULT_DRAFT.accentFrom),
      accentTo: readVar("--accent-to", DEFAULT_DRAFT.accentTo),
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(seed);
  }, [activeColors]);

  function update(key: keyof ThemeColors, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setCustomColors(next);
  }

  return (
    <div className="space-y-5 text-sm">
      <div>
        <h2 className="font-semibold">Theme builder</h2>
        <p className="text-xs text-fg/50">
          Pick colors to build a custom theme — changes apply live. Choosing a
          light/dark theme above clears it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="color"
              value={draft[key]}
              onChange={(e) => update(key, e.target.value)}
              aria-label={label}
              className="h-8 w-8 shrink-0 cursor-pointer rounded border border-fg/10 bg-transparent"
            />
            <span className="text-fg/60">{label}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Theme name"
          className="accent-focus min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
        />
        <button
          type="button"
          onClick={() => {
            saveNamedTheme(name, draft);
            setName("");
          }}
          className="btn-accent shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-black hover:opacity-90"
        >
          Save
        </button>
      </div>

      {customThemes.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-fg/50">Saved themes</span>
          {customThemes.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2"
            >
              <span
                className="h-5 w-5 shrink-0 rounded-full ring-1 ring-fg/10"
                style={{
                  background: `linear-gradient(135deg, ${t.accentFrom}, ${t.accentTo})`,
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <button
                type="button"
                onClick={() => applyNamedTheme(t.id)}
                className="shrink-0 rounded-md border border-fg/10 bg-fg/5 px-2.5 py-1 text-xs text-fg/80 transition-colors hover:bg-fg/10"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => deleteNamedTheme(t.id)}
                aria-label={`Delete ${t.name}`}
                className="shrink-0 rounded-md px-1.5 py-1 text-xs text-fg/40 transition-colors hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {activeColors && (
        <button
          type="button"
          onClick={clearCustomTheme}
          className="text-xs text-fg/40 underline transition-colors hover:text-fg/70"
        >
          Remove custom theme
        </button>
      )}
    </div>
  );
}
