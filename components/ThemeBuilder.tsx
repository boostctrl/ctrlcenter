"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { BASE_THEMES, DEFAULT_THEME_NAME, DESIGNS, SCENES } from "@/lib/theme";
import type { ColorSet, DesignId, SceneId, ThemePack } from "@/lib/theme";
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
// by the active accent. The base is the live surface (`var(--background)`), so
// every swatch tracks the current light/dark mode.
function scenePreview(id: SceneId, from: string, to: string): string {
  const mix = (c: string, pct: number) =>
    `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const bg = "var(--background)";
  switch (id) {
    case "abyss":
      return `radial-gradient(120% 90% at 50% -10%, ${from}, transparent 60%), ${bg}`;
    case "nebula":
      return `radial-gradient(45% 55% at 22% 28%, ${from}, transparent 60%), radial-gradient(50% 60% at 75% 68%, ${to}, transparent 60%), radial-gradient(40% 50% at 55% 45%, ${from}, transparent 65%), radial-gradient(35% 45% at 40% 80%, ${to}, transparent 65%), ${bg}`;
    case "grid":
      return `linear-gradient(to top, ${mix(from, 50)}, transparent 55%), repeating-linear-gradient(90deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), repeating-linear-gradient(0deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), ${bg}`;
    case "starfield":
      return `radial-gradient(1.5px 1.5px at 22% 32%, ${from}, transparent), radial-gradient(1.5px 1.5px at 62% 58%, ${to}, transparent), radial-gradient(2px 2px at 82% 26%, ${from}, transparent), radial-gradient(1.5px 1.5px at 42% 78%, ${to}, transparent), ${bg}`;
    case "constellation":
      return `linear-gradient(58deg, transparent 47%, ${mix(from, 50)} 48% 52%, transparent 53%), radial-gradient(2px 2px at 25% 35%, ${from}, transparent), radial-gradient(2px 2px at 68% 60%, ${to}, transparent), radial-gradient(2px 2px at 50% 82%, ${from}, transparent), ${bg}`;
    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% -12%, ${mix(from, 65)} 0 3deg, transparent 3deg 12deg), ${bg}`;
    case "waves":
      return `linear-gradient(to top, ${mix(from, 52)}, transparent 45%), linear-gradient(to top, ${mix(to, 32)}, transparent 65%), ${bg}`;
    case "aurora":
    default:
      return `radial-gradient(60% 70% at 30% 20%, ${from}, transparent 60%), radial-gradient(60% 70% at 75% 80%, ${to}, transparent 60%), ${bg}`;
  }
}

export default function ThemeBuilder({ packs }: { packs: ThemePack[] }) {
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
    activeAccent,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    resetTheme,
    surfaceIsLight,
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

  function saveTheme() {
    if (!name.trim()) return;
    // Save the active look's full light+dark pair (so it restores in both
    // modes), with the current accent applied to both variants. With no active
    // look yet, seed both modes from the live draft.
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
  }

  // A full-palette swatch (surface bg + accent glow) for the current mode, so the
  // theme/palette previews track light/dark instead of always showing dark.
  const lookSwatch = (look: { dark: ColorSet; light: ColorSet }) => {
    const cs = surfaceIsLight ? look.light : look.dark;
    return `radial-gradient(120% 100% at 50% -10%, ${cs.accentFrom}, transparent 60%), ${cs.background}`;
  };

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

      <div className="space-y-3 rounded-xl border border-fg/15 bg-fg/[0.02] p-3">
        <div>
          <span className="text-sm font-medium text-fg/80">Themes</span>
          <p className="text-xs text-fg/40">
            Presets — pick one to set the design, scene &amp; colors (light &amp;
            dark) below in one tap.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {packs.map((p) => (
            <button
              key={`builtin:${p.name}`}
              type="button"
              onClick={() => applyPack(p)}
              className="group relative flex flex-col gap-1.5 rounded-lg border border-fg/10 p-2 text-left transition-colors hover:border-fg/30"
              title={`${p.name} · ${DESIGN_NAMES[p.design]}`}
            >
              {p.name === DEFAULT_THEME_NAME && (
                <span className="absolute top-1 right-1 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-fg/70 uppercase">
                  Default
                </span>
              )}
              <span
                className="h-9 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                style={{ background: lookSwatch(p) }}
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
                  style={{ background: lookSwatch(t) }}
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
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveTheme()}
            placeholder="Name & save your current look as a theme"
            className="accent-focus min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
          />
          <button
            type="button"
            onClick={saveTheme}
            className="btn-accent shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-black hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold tracking-[0.15em] text-fg/45 uppercase">
          Customize
        </span>
        <div className="h-px flex-1 bg-fg/10" />
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
                  className={`pointer-events-none block ${d.id === "glass" ? "" : `design-${d.id}`}`}
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

      <div className="space-y-3 rounded-xl border border-fg/15 bg-fg/[0.02] p-3">
        <div>
          <span className="text-sm font-medium text-fg/80">Palette</span>
          <p className="text-xs text-fg/40">
            The colors. Pick a preset, then fine-tune the current mode below —
            background, text &amp; accent together make a palette, and the accent
            is just its gradient.
          </p>
        </div>
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
                className="h-9 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                style={{ background: lookSwatch(t) }}
                aria-hidden
              />
              <span className="truncate text-xs text-fg/60 group-hover:text-fg/90">
                {t.name}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-3 border-t border-fg/10 pt-3">
          <span className="text-xs font-medium text-fg/55">
            Customize (this mode)
          </span>
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
          <div className="space-y-2">
            <span className="text-xs text-fg/50">Accent (gradient)</span>
            <div
              className="h-9 w-full rounded-lg ring-1 ring-fg/10"
              style={{
                backgroundImage: `linear-gradient(to right, ${activeAccent.from}, ${activeAccent.to})`,
              }}
              aria-hidden
            />
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
            <p className="text-xs text-fg/40">
              Set both ends to the same color for a solid accent.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-fg/10 pt-4">
        <button
          type="button"
          onClick={resetTheme}
          className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
        >
          Reset theme to default
        </button>
      </div>
    </div>
  );
}
