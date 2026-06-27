"use client";

import { useEffect, useRef, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { BASE_THEMES, DESIGNS, SCENES } from "@/lib/theme";
import type { ColorSet, DesignId, SceneId, ThemePack } from "@/lib/theme";
import { FONTS, fontVar } from "@/lib/fonts";
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

// Surface defaults per mode (mirror the :root / .theme-light CSS), used to seed
// the pickers when editing a mode that has no custom colors yet.
const MODE_DEFAULTS: Record<"dark" | "light", { background: string; foreground: string }> = {
  dark: { background: "#06070d", foreground: "#f4f4f6" },
  light: { background: "#eceef3", foreground: "#181b24" },
};

const BASE_FIELDS: { key: "background" | "foreground"; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
];

const ACCENT_FIELDS: { key: "accentFrom" | "accentTo"; label: string }[] = [
  { key: "accentFrom", label: "Start" },
  { key: "accentTo", label: "End" },
];

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
      return `linear-gradient(54deg, transparent 48%, ${mix(from, 45)} 49% 51%, transparent 52%), radial-gradient(1.5px 1.5px at 22% 32%, ${from}, transparent), radial-gradient(2px 2px at 50% 80%, ${from}, transparent), radial-gradient(1.5px 1.5px at 62% 58%, ${to}, transparent), radial-gradient(2px 2px at 82% 26%, ${from}, transparent), radial-gradient(1.5px 1.5px at 42% 78%, ${to}, transparent), ${bg}`;
    case "traces":
      return [
        `radial-gradient(circle, ${from} 55%, transparent 60%) 12% 40% / 7px 7px no-repeat`,
        `radial-gradient(circle, ${to} 55%, transparent 60%) 84% 78% / 7px 7px no-repeat`,
        `linear-gradient(${mix(from, 55)}, ${mix(from, 55)}) 12% 40% / 44% 2px no-repeat`,
        `linear-gradient(${mix(from, 55)}, ${mix(from, 55)}) 56% 40% / 2px 40% no-repeat`,
        `linear-gradient(${mix(to, 50)}, ${mix(to, 50)}) 40% 78% / 44% 2px no-repeat`,
        bg,
      ].join(", ");
    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% -12%, ${mix(from, 65)} 0 3deg, transparent 3deg 12deg), ${bg}`;
    case "waves":
      return `linear-gradient(to top, ${mix(from, 52)}, transparent 45%), linear-gradient(to top, ${mix(to, 32)}, transparent 65%), ${bg}`;
    case "dots":
      return `radial-gradient(${mix(from, 70)} 1px, transparent 1.5px) 0 0 / 6px 6px, ${bg}`;
    case "glow":
      return `radial-gradient(circle at 50% 50%, ${from}, ${mix(to, 40)} 45%, transparent 70%), ${bg}`;
    case "vortex":
      return `conic-gradient(from 0deg at 50% 50%, transparent 0deg, ${mix(from, 70)} 50deg, transparent 130deg, ${mix(to, 55)} 220deg, transparent 300deg), ${bg}`;
    case "mesh":
      return `radial-gradient(55% 55% at 20% 20%, ${from}, transparent 60%), radial-gradient(55% 55% at 80% 80%, ${to}, transparent 60%), ${bg}`;
    case "aurora":
    default:
      return `radial-gradient(60% 70% at 30% 20%, ${from}, transparent 60%), radial-gradient(60% 70% at 75% 80%, ${to}, transparent 60%), ${bg}`;
  }
}

export default function ThemeBuilder({ packs }: { packs: ThemePack[] }) {
  const {
    designFor,
    setDesign,
    sceneFor,
    setScene,
    fontFor,
    setFont,
    applyPack,
    customThemes,
    activeLook,
    activeAccent,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    resetTheme,
    resolvedMode,
    setPreviewMode,
  } = useVisitorPrefs();

  // Always edit the mode that's actually on screen, so what you tweak is what you
  // see. The Editing toggle below switches modes by previewing them live (see
  // setPreviewMode) rather than keeping a separate, hidden edit target.
  const editMode = resolvedMode;

  // The preview is display-only and never persisted, so dropping it when the
  // builder unmounts returns the visitor to their saved Appearance mode the
  // moment they leave the page. A latest-value ref keeps this an unmount-only
  // cleanup that still calls the current setPreviewMode (whose identity changes
  // as theme state updates), so it applies the up-to-date look, not a stale one.
  const dropPreview = useRef(setPreviewMode);
  useEffect(() => {
    dropPreview.current = setPreviewMode;
  });
  useEffect(() => () => dropPreview.current(null), []);

  const [draft, setDraft] = useState<ThemeColors>(DEFAULT_DRAFT);
  const [name, setName] = useState("");

  // Keep the pickers in sync with the edit mode's colorset. Background/text come
  // from the active look's chosen-mode variant (or that mode's defaults when
  // there's no custom look yet); the accent is shared across modes.
  useEffect(() => {
    const cs = activeLook ? activeLook[editMode] : null;
    const dflt = MODE_DEFAULTS[editMode];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({
      background: cs?.background ?? dflt.background,
      foreground: cs?.foreground ?? dflt.foreground,
      accentFrom: activeAccent.from,
      accentTo: activeAccent.to,
    });
  }, [activeLook, editMode, activeAccent]);

  function updateBase(key: "background" | "foreground", value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setBaseColors(next.background, next.foreground, editMode === "dark");
  }

  function updateAccent(key: "accentFrom" | "accentTo", value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setAccentOverride({ from: next.accentFrom, to: next.accentTo });
  }

  function saveTheme() {
    if (!name.trim()) return;
    // Captures the full current look — both modes' design, scene, font and
    // colors — so it restores as two complete, independent themes.
    saveNamedTheme(name);
    setName("");
  }

  // A full-palette swatch (surface bg + accent glow) for the current mode — used
  // for the theme packs, where the whole look (incl. background) matters.
  const lookSwatch = (look: { dark: ColorSet; light: ColorSet }) => {
    const cs = editMode === "light" ? look.light : look.dark;
    return `radial-gradient(120% 100% at 50% -10%, ${cs.accentFrom}, transparent 60%), ${cs.background}`;
  };

  // A palette swatch: just the accent gradient (clearer than washing it over the
  // background), still mode-aware via the current colorset.
  const paletteGradient = (look: { dark: ColorSet; light: ColorSet }) => {
    const cs = editMode === "light" ? look.light : look.dark;
    return `linear-gradient(135deg, ${cs.accentFrom}, ${cs.accentTo})`;
  };

  return (
    <div className="space-y-5 text-sm">
      <div>
        <h2 className="font-semibold">Theme builder</h2>
        <p className="text-xs text-fg/50">
          Light and dark are two independent themes. Pick a mode with the Editing
          toggle below, then design it — its own design, scene, font &amp; colors.
          Switch the app between light and dark in Preferences.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-fg/15 bg-fg/[0.02] p-3">
        <div>
          <span className="text-sm font-medium text-fg/80">Themes</span>
          <p className="text-xs text-fg/40">
            Presets — pick one to set the design, scene &amp; colors for the mode
            you&apos;re editing ({editMode}) in one tap.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {packs.map((p, i) => (
            <button
              key={`builtin:${i}`}
              type="button"
              onClick={() => applyPack(p, editMode)}
              className="group relative flex flex-col gap-1.5 rounded-lg border border-fg/10 p-2 text-left transition-colors hover:border-fg/30"
              title={`${p.name} · ${DESIGN_NAMES[p.design]}`}
            >
              {i === 0 && (
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

      {/* The Editing toggle governs everything below — design, scene, font and
          palette — so light and dark can be wholly different themes. Switching it
          previews that mode live (setPreviewMode) so edits are visible. */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-fg/15 bg-fg/[0.02] p-3">
        <div>
          <span className="text-sm font-medium text-fg/80">Editing</span>
          <p className="text-xs text-fg/40">
            Which mode you&apos;re designing — light and dark are independent.
            Switching previews it here so you can see your edits; it won&apos;t
            change your saved Appearance mode, and reverts when you leave.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-fg/10">
          {(["dark", "light"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPreviewMode(m)}
              aria-pressed={editMode === m}
              className={`px-4 py-1.5 text-xs capitalize transition-colors ${
                editMode === m
                  ? "bg-fg/15 text-fg"
                  : "text-fg/50 hover:text-fg/80"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-fg/50">Design</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DESIGNS.map((d) => {
            const selected = designFor(editMode) === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDesign(d.id, editMode)}
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
            const selected = sceneFor(editMode) === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScene(s.id, editMode)}
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
        <span className="text-xs text-fg/50">Font</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FONTS.map((f) => {
            const selected = fontFor(editMode) === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFont(f.id, editMode)}
                aria-pressed={selected}
                className={`group flex flex-col gap-0.5 rounded-lg border p-2 text-left transition-colors ${
                  selected ? "border-fg/40" : "border-fg/10 hover:border-fg/30"
                }`}
                title={f.name}
              >
                <span
                  className="text-xl leading-tight text-fg/90"
                  style={{ fontFamily: fontVar(f.id) }}
                  aria-hidden
                >
                  Ag
                </span>
                <span
                  className={`truncate text-xs ${
                    selected ? "text-fg/90" : "text-fg/60 group-hover:text-fg/90"
                  }`}
                  style={{ fontFamily: fontVar(f.id) }}
                >
                  {f.name}
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
              onClick={() => applyThemeColors(t, editMode)}
              className="group flex flex-col gap-1.5 rounded-lg border border-fg/10 p-2 text-left transition-colors hover:border-fg/30"
              title={t.name}
            >
              <span
                className="h-9 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                style={{ background: paletteGradient(t) }}
                aria-hidden
              />
              <span className="truncate text-xs text-fg/60 group-hover:text-fg/90">
                {t.name}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-3 border-t border-fg/10 pt-3">
          <span className="text-xs font-medium text-fg/55 capitalize">
            Fine-tune {editMode}
          </span>

          {/* Preview of the mode being edited (so the off mode has feedback). */}
          <div
            className="flex h-10 items-end justify-start overflow-hidden rounded-lg p-1.5 ring-1 ring-fg/10"
            style={{
              background: `radial-gradient(120% 100% at 50% -10%, ${draft.accentFrom}, transparent 60%), ${draft.background}`,
            }}
          >
            <span
              className="rounded px-1 text-[9px] font-medium capitalize"
              style={{ color: draft.foreground }}
            >
              {editMode} preview
            </span>
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
          <div className="space-y-2">
            <span className="text-xs text-fg/50">
              Accent (gradient) · shared by both modes
            </span>
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
