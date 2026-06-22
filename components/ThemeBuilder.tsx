"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { BASE_THEMES, DESIGNS, SCENES, THEME_PACKS } from "@/lib/theme";
import type { DesignId, SceneId } from "@/lib/theme";
import type { ThemeColors } from "@/lib/prefs";

const DESIGN_NAMES = Object.fromEntries(
  DESIGNS.map((d) => [d.id, d.name])
) as Record<DesignId, string>;

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

// A small representative gradient for each scene's picker swatch, recolored live
// by the active accent.
function scenePreview(id: SceneId, from: string, to: string): string {
  const mix = (c: string, pct: number) =>
    `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  switch (id) {
    case "abyss":
      return `radial-gradient(120% 90% at 50% -10%, ${from}, transparent 60%), linear-gradient(to bottom, #02060a, #0a2230)`;
    case "nebula":
      return `radial-gradient(50% 60% at 25% 30%, ${from}, transparent 60%), radial-gradient(55% 65% at 75% 70%, ${to}, transparent 60%), radial-gradient(45% 55% at 55% 45%, ${from}, transparent 65%)`;
    case "grid":
      return `linear-gradient(to top, ${mix(from, 50)}, transparent 55%), repeating-linear-gradient(90deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), repeating-linear-gradient(0deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), #0c0716`;
    case "starfield":
      return `radial-gradient(1.5px 1.5px at 22% 32%, ${from}, transparent), radial-gradient(1.5px 1.5px at 62% 58%, ${to}, transparent), radial-gradient(2px 2px at 82% 26%, ${from}, transparent), radial-gradient(1.5px 1.5px at 42% 78%, ${to}, transparent), #05070f`;
    case "waves":
      return `linear-gradient(to top, ${mix(from, 52)}, transparent 45%), linear-gradient(to top, ${mix(to, 32)}, transparent 65%), #04110f`;
    case "aurora":
    default:
      return `radial-gradient(60% 70% at 30% 20%, ${from}, transparent 60%), radial-gradient(60% 70% at 75% 80%, ${to}, transparent 60%)`;
  }
}

export default function ThemeBuilder() {
  const {
    theme,
    setTheme,
    design,
    setDesign,
    scene,
    setScene,
    applyPack,
    customThemes,
    activeLook,
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
          Pick a design and a palette, then tweak the colors — changes apply
          live. Every look has a matching light and dark; the Mode toggle
          switches between them, and the color pickers edit the current mode.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-fg/50">Mode</span>
        <div className="flex overflow-hidden rounded-lg border border-fg/10">
          {(["system", "light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                theme === t ? "bg-fg/15 text-fg" : "text-fg/50 hover:text-fg/80"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-fg/50">Themes</span>
        <p className="text-xs text-fg/40">
          Full looks — palette, design, and scene (light &amp; dark) in one tap.
          Save your own with the field below.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_PACKS.map((p) => (
            <button
              key={`builtin:${p.name}`}
              type="button"
              onClick={() => applyPack(p)}
              className="group flex flex-col gap-1.5 rounded-lg border border-fg/10 p-2 text-left transition-colors hover:border-fg/30"
              title={`${p.name} · ${DESIGN_NAMES[p.design]}`}
            >
              <span
                className="h-9 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                style={{
                  background: `radial-gradient(120% 100% at 50% -10%, ${p.dark.accentFrom}, transparent 60%), ${p.dark.background}`,
                }}
                aria-hidden
              />
              <span className="truncate text-xs text-fg/60 group-hover:text-fg/90">
                {p.name}
              </span>
            </button>
          ))}
          {customThemes.map((t) => (
            <div key={t.id} className="group relative">
              <button
                type="button"
                onClick={() => applyNamedTheme(t.id)}
                className="flex w-full flex-col gap-1.5 rounded-lg border border-fg/10 p-2 text-left transition-colors hover:border-fg/30"
                title={`${t.name} · ${DESIGN_NAMES[t.design]}`}
              >
                <span
                  className="h-9 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                  style={{
                    background: `radial-gradient(120% 100% at 50% -10%, ${t.dark.accentFrom}, transparent 60%), ${t.dark.background}`,
                  }}
                  aria-hidden
                />
                <span className="truncate text-xs text-fg/60 group-hover:text-fg/90">
                  {t.name}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteNamedTheme(t.id)}
                aria-label={`Delete ${t.name}`}
                className="absolute top-1 right-1 rounded-md bg-background/70 px-1 text-xs text-fg/50 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-fg/50">Design</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DESIGNS.map((d) => {
            const selected = design === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDesign(d.id)}
                aria-pressed={selected}
                className={`group flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${
                  selected ? "border-fg/40" : "border-fg/10 hover:border-fg/30"
                }`}
                title={d.description}
              >
                <span
                  className={`block ${d.id === "glass" ? "" : `design-${d.id}`}`}
                >
                  <span className="glass-card flex h-9 w-full items-center justify-center">
                    <span
                      className="h-1.5 w-9 rounded-full"
                      style={{
                        backgroundImage: `linear-gradient(to right, ${activeAccent.from}, ${activeAccent.to})`,
                      }}
                      aria-hidden
                    />
                  </span>
                </span>
                <span
                  className={`truncate text-xs ${
                    selected ? "text-fg/90" : "text-fg/60 group-hover:text-fg/90"
                  }`}
                >
                  {d.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-fg/50">Scene</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCENES.map((s) => {
            const selected = scene === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScene(s.id)}
                aria-pressed={selected}
                className={`group flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${
                  selected ? "border-fg/40" : "border-fg/10 hover:border-fg/30"
                }`}
                title={s.description}
              >
                <span
                  className="block h-9 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                  style={{
                    background: scenePreview(s.id, activeAccent.from, activeAccent.to),
                  }}
                  aria-hidden
                />
                <span
                  className={`truncate text-xs ${
                    selected ? "text-fg/90" : "text-fg/60 group-hover:text-fg/90"
                  }`}
                >
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-fg/50">Palettes</span>
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
                  background: `linear-gradient(135deg, ${t.dark.accentFrom}, ${t.dark.accentTo})`,
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
        <p className="text-xs text-fg/40">
          Set both ends to the same color for a solid accent.
        </p>
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
            // Save the active look's full light+dark pair (so it restores in
            // both modes), with the current accent applied to both variants. If
            // there's no active look yet, seed both modes from the live draft.
            const draftCS = {
              background: draft.background,
              foreground: draft.foreground,
              accentFrom: activeAccent.from,
              accentTo: activeAccent.to,
            };
            const look = activeLook ?? { dark: draftCS, light: draftCS };
            const accent = { accentFrom: activeAccent.from, accentTo: activeAccent.to };
            saveNamedTheme(name, {
              dark: { ...look.dark, ...accent },
              light: { ...look.light, ...accent },
            });
            setName("");
          }}
          className="btn-accent shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-black hover:opacity-90"
        >
          Save
        </button>
      </div>

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
