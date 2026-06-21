"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { ACCENTS, ACCENT_KEYS, BASE_THEMES } from "@/lib/theme";
import type { ThemeColors } from "@/lib/prefs";

const DEFAULT_DRAFT: ThemeColors = {
  background: "#06070d",
  foreground: "#f4f4f6",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

const BASE_FIELDS: { key: "background" | "foreground"; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
];

const ACCENT_FIELDS: { key: "accentFrom" | "accentTo"; label: string }[] = [
  { key: "accentFrom", label: "Start" },
  { key: "accentTo", label: "End" },
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
    accentOverride,
    activeAccent,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    clearCustomTheme,
  } = useVisitorPrefs();

  const [draft, setDraft] = useState<ThemeColors>(DEFAULT_DRAFT);
  const [name, setName] = useState("");

  // Keep the pickers in sync with the active theme/accent. Background and text
  // come from the active custom theme (or the current mode's colors); the accent
  // pickers follow the resolved accent (override → theme → admin default).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({
      background: activeColors?.background ?? readVar("--background", DEFAULT_DRAFT.background),
      foreground: activeColors?.foreground ?? readVar("--foreground", DEFAULT_DRAFT.foreground),
      accentFrom: activeAccent.from,
      accentTo: activeAccent.to,
    });
  }, [activeColors, activeAccent]);

  function updateBase(key: "background" | "foreground", value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setBaseColors(next.background, next.foreground);
  }

  function updateAccent(key: "accentFrom" | "accentTo", value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setAccentOverride({ from: next.accentFrom, to: next.accentTo });
  }

  return (
    <div className="space-y-5 text-sm">
      <div>
        <h2 className="font-semibold">Theme builder</h2>
        <p className="text-xs text-fg/50">
          Start from a base theme, then tweak the colors — changes apply live.
          Pick an accent on its own to recolor without touching the rest.
        </p>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-fg/50">Base themes</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BASE_THEMES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => applyThemeColors(t)}
              className="group flex flex-col gap-1.5 rounded-lg border border-fg/10 p-2 text-left transition-colors hover:border-fg/30"
              title={t.name}
            >
              <span
                className="h-9 w-full rounded-md ring-1 ring-fg/10"
                style={{
                  background: `linear-gradient(135deg, ${t.accentFrom}, ${t.accentTo})`,
                }}
                aria-hidden
              />
              <span className="truncate text-xs text-fg/60 group-hover:text-fg/90">
                {t.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {BASE_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="color"
              value={draft[key]}
              onChange={(e) => updateBase(key, e.target.value)}
              aria-label={label}
              className="h-8 w-8 shrink-0 cursor-pointer rounded border border-fg/10 bg-transparent"
            />
            <span className="text-fg/60">{label}</span>
          </label>
        ))}
      </div>

      <div className="space-y-2.5">
        <span className="text-xs text-fg/50">Accent</span>
        <div
          className="h-9 w-full rounded-lg ring-1 ring-fg/10"
          style={{
            backgroundImage: `linear-gradient(to right, ${activeAccent.from}, ${activeAccent.to})`,
          }}
          aria-hidden
        />
        <div className="flex flex-wrap gap-2">
          {ACCENT_KEYS.map((key) => {
            const { from, to } = ACCENTS[key];
            const selected =
              activeAccent.from === from && activeAccent.to === to;
            return (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={selected}
                title={key}
                onClick={() => setAccentOverride({ from, to })}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-[var(--background)] transition ${
                  selected ? "ring-fg/80" : "ring-transparent hover:ring-fg/30"
                }`}
                style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {ACCENT_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="color"
                value={draft[key]}
                onChange={(e) => updateAccent(key, e.target.value)}
                aria-label={`Accent ${label.toLowerCase()}`}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-fg/10 bg-transparent"
              />
              <span className="text-fg/60">{label}</span>
            </label>
          ))}
        </div>
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
            saveNamedTheme(name, {
              background: draft.background,
              foreground: draft.foreground,
              accentFrom: activeAccent.from,
              accentTo: activeAccent.to,
            });
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

      {(activeColors || accentOverride) && (
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
