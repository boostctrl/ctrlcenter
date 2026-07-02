"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { BASE_THEMES, DESIGNS, SCENES } from "@/lib/theme";
import type { DesignId, ModeColors, SceneId, ThemePack } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { FONTS, fontVar } from "@/lib/fonts";
import type { ThemeColors } from "@/lib/prefs";
import { deepenForLight } from "./scenes/color";

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

// The builder's sections, one per tab. Tabs keep the five option grids from
// stacking into one endless scroll — you see one grid at a time, while the
// header (mode switch) and footer (save/reset) stay put around them.
const TABS = [
  { id: "themes", name: "Themes" },
  { id: "colors", name: "Colors" },
  { id: "design", name: "Design" },
  { id: "scene", name: "Scene" },
  { id: "font", name: "Font" },
] as const;
type TabId = (typeof TABS)[number]["id"];

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
    case "horizon":
      return `linear-gradient(${mix(from, 90)}, ${mix(from, 90)}) 0 62% / 100% 1px no-repeat, radial-gradient(circle at 50% 68%, ${from}, ${mix(to, 55)} 32%, transparent 52%), linear-gradient(to top, ${mix(to, 25)} 38%, transparent 38%), ${bg}`;
    case "orbit":
      return `radial-gradient(circle at 72% 34%, ${from} 4%, transparent 5.5%, transparent 17%, ${mix(from, 70)} 18%, transparent 19.5%, transparent 37%, ${mix(to, 55)} 38%, transparent 39.5%, transparent 57%, ${mix(from, 45)} 58%, transparent 59.5%), ${bg}`;
    case "peaks":
      return `linear-gradient(155deg, transparent 52%, ${mix(to, 30)} 52.5%), linear-gradient(205deg, transparent 55%, ${mix(from, 45)} 55.5%), linear-gradient(160deg, transparent 68%, ${mix(from, 65)} 68.5%), ${bg}`;
    case "rain":
      return `repeating-linear-gradient(100deg, transparent 0 5px, ${mix(from, 55)} 5px 6px, transparent 6px 13px, ${mix(to, 40)} 13px 14px), ${bg}`;
    case "fireflies":
      return `radial-gradient(4px 4px at 24% 38%, ${from}, transparent), radial-gradient(3px 3px at 64% 26%, ${to}, transparent), radial-gradient(4.5px 4.5px at 82% 66%, ${from}, transparent), radial-gradient(3px 3px at 44% 74%, ${to}, transparent), radial-gradient(2.5px 2.5px at 12% 72%, ${from}, transparent), ${bg}`;
    case "blueprint":
      return `radial-gradient(circle at 70% 42%, transparent 26%, ${mix(to, 70)} 27%, transparent 29%), repeating-linear-gradient(90deg, ${mix(from, 35)} 0 1px, transparent 1px 7px), repeating-linear-gradient(0deg, ${mix(from, 35)} 0 1px, transparent 1px 7px), ${bg}`;
    case "prisms":
      return `conic-gradient(from 205deg at 30% 42%, ${mix(from, 60)} 0 55deg, transparent 55deg), conic-gradient(from 20deg at 68% 64%, ${mix(to, 50)} 0 48deg, transparent 48deg), conic-gradient(from 120deg at 84% 22%, ${mix(from, 40)} 0 60deg, transparent 60deg), ${bg}`;
    case "aurora":
    default:
      return `radial-gradient(60% 70% at 30% 20%, ${from}, transparent 60%), radial-gradient(60% 70% at 75% 80%, ${to}, transparent 60%), ${bg}`;
  }
}

// The shared shape of every option tile: swatch on top (children), name +
// optional description below, an optional corner badge, and an accent check
// when it's the active choice. Options that are one-shot actions rather than
// state (packs, palettes) simply omit `selected`.
function OptionCard({
  onClick,
  name,
  selected,
  desc,
  title,
  badge,
  nameStyle,
  children,
}: {
  onClick: () => void;
  name: string;
  selected?: boolean;
  desc?: string;
  title?: string;
  badge?: string;
  nameStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={`group relative flex w-full flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${
        selected ? "border-[color:var(--accent-from)]" : "border-fg/10 hover:border-fg/30"
      }`}
    >
      {children}
      <span className="min-w-0">
        <span
          className={`block truncate text-xs ${
            selected ? "text-fg/90" : "text-fg/60 group-hover:text-fg/90"
          }`}
          style={nameStyle}
        >
          {name}
        </span>
        {desc && (
          <span className="block truncate text-[10px] text-fg/40">{desc}</span>
        )}
      </span>
      {badge && (
        <span className="absolute top-1 right-1 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-fg/70 uppercase">
          {badge}
        </span>
      )}
      {selected && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--accent-from)] text-[color:var(--accent-fg)] shadow-sm">
          <svg
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2.5 6.5 5 9l4.5-6" />
          </svg>
        </span>
      )}
    </button>
  );
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
  // see. The Editing toggle in the header switches modes by previewing them live
  // (see setPreviewMode) rather than keeping a separate, hidden edit target.
  const editMode = resolvedMode;

  // Scene swatches paint the accent over the previewed surface, so on light they
  // must deepen it the same way the real scenes do (PrefsProvider / scenes/color)
  // — otherwise the swatch washes out while the live scene behind it pops.
  const sceneFrom =
    editMode === "light"
      ? `rgb(${deepenForLight(activeAccent.from)})`
      : activeAccent.from;
  const sceneTo =
    editMode === "light"
      ? `rgb(${deepenForLight(activeAccent.to)})`
      : activeAccent.to;

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

  const [tab, setTab] = useState<TabId>("themes");
  const [draft, setDraft] = useState<ThemeColors>(DEFAULT_DRAFT);
  const [name, setName] = useState("");
  // Whether the accent editor shows one color well or a from→to pair. Solid is
  // just a gradient with two equal stops, so this is purely a UI simplification
  // for the common "I want one color" case.
  const [accentStyle, setAccentStyle] = useState<"gradient" | "solid">(() =>
    activeAccent.from.toLowerCase() === activeAccent.to.toLowerCase()
      ? "solid"
      : "gradient"
  );

  // Keep the pickers in sync with the edit mode's colorset. Background/text come
  // from the active look's chosen-mode variant (or that mode's defaults when
  // there's no custom look yet); activeAccent resolves for the edit mode too.
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

  // A palette or saved theme can bring in a two-color accent the Solid editor
  // can't represent — flip back to the gradient editor when that happens.
  useEffect(() => {
    if (draft.accentFrom.toLowerCase() !== draft.accentTo.toLowerCase()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccentStyle("gradient");
    }
  }, [draft.accentFrom, draft.accentTo]);

  function updateBase(key: "background" | "foreground", value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setBaseColors(next.background, next.foreground, editMode === "dark");
  }

  function updateAccent(key: "accentFrom" | "accentTo", value: string) {
    const next =
      accentStyle === "solid"
        ? { ...draft, accentFrom: value, accentTo: value }
        : { ...draft, [key]: value };
    setDraft(next);
    setAccentOverride({ from: next.accentFrom, to: next.accentTo }, editMode);
  }

  function chooseAccentStyle(style: "gradient" | "solid") {
    setAccentStyle(style);
    // Collapsing to solid keeps the start color; going back to gradient changes
    // nothing until an end color is picked.
    if (style === "solid" && draft.accentFrom !== draft.accentTo) {
      const next = { ...draft, accentTo: draft.accentFrom };
      setDraft(next);
      setAccentOverride({ from: next.accentFrom, to: next.accentTo }, editMode);
    }
  }

  function saveTheme() {
    if (!name.trim()) return;
    // Captures the full current look — both modes' design, scene, font and
    // colors — so it restores as two complete, independent themes.
    saveNamedTheme(name);
    setName("");
  }

  // A full-look swatch (surface bg + accent glow) for the current mode — used
  // for the theme packs and saved themes, which restyle the mode being edited.
  const lookSwatch = (look: ModeColors) => {
    const cs = editMode === "light" ? look.light : look.dark;
    return `radial-gradient(120% 100% at 50% -10%, ${cs.accentFrom}, transparent 60%), ${cs.background}`;
  };

  // Palettes recolor BOTH modes at once, so their swatch shows both halves —
  // dark surface left, light surface right, each with its ink — over an accent
  // strip that blends from the dark half's accent pair into the light half's.
  const PaletteSwatch = ({ look }: { look: ModeColors }) => (
    <span
      className="relative block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
      aria-hidden
    >
      {(
        [
          ["dark", "left-0"],
          ["light", "right-0"],
        ] as const
      ).map(([m, side]) => (
        <span
          key={m}
          className={`absolute inset-y-0 ${side} w-1/2`}
          style={{ background: look[m].background }}
        >
          <span
            className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] leading-none font-semibold"
            style={{ color: look[m].foreground }}
          >
            A
          </span>
        </span>
      ))}
      <span
        className="absolute inset-x-0 bottom-0 h-2.5"
        style={{
          backgroundImage: `linear-gradient(to right, ${look.dark.accentFrom}, ${look.dark.accentTo} 48%, ${look.light.accentFrom} 52%, ${look.light.accentTo})`,
        }}
      />
    </span>
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="font-semibold">Theme builder</h2>
          <p className="text-xs text-fg/50">
            Light and dark are two independent themes — design each with its own
            style, scene, font &amp; colors. Everything applies live.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg/50">Editing</span>
            <div className="flex overflow-hidden rounded-lg border border-fg/10">
              {(["dark", "light"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPreviewMode(m)}
                  aria-pressed={editMode === m}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs capitalize transition-colors ${
                    editMode === m
                      ? "bg-fg/15 text-fg"
                      : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {m === "dark" ? (
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="5" />
                        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                      </>
                    )}
                  </svg>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-fg/40">
            Previews live — your saved Appearance mode is untouched.
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Theme builder sections"
        className="flex gap-1 overflow-x-auto border-b border-fg/10"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tb-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`tb-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`relative shrink-0 px-3 py-2 text-xs font-medium transition-colors ${
                active ? "text-fg" : "text-fg/50 hover:text-fg/80"
              }`}
            >
              {t.name}
              {active && (
                <span
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, var(--accent-from), var(--accent-to))",
                  }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {tab === "themes" && (
        <div
          role="tabpanel"
          id="tb-panel-themes"
          aria-labelledby="tb-tab-themes"
          className="space-y-4"
        >
          <p className="text-xs text-fg/40">
            Curated looks — one tap sets the design, scene &amp; colors of your{" "}
            {editMode} theme.{" "}
            Tweak it in the other tabs, then name &amp; save your own below.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {packs.map((p, i) => (
              <OptionCard
                key={`builtin:${i}`}
                onClick={() => applyPack(p, editMode)}
                name={p.name}
                title={`${p.name} · ${DESIGN_NAMES[p.design]}`}
                badge={i === 0 ? "Default" : undefined}
              >
                <span
                  className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                  style={{ background: lookSwatch(p) }}
                  aria-hidden
                />
              </OptionCard>
            ))}
          </div>
          {customThemes.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold tracking-[0.15em] text-fg/45 uppercase">
                Your themes
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {customThemes.map((t) => (
                  <div key={t.id} className="group/theme relative">
                    <OptionCard
                      onClick={() => applyNamedTheme(t.id)}
                      name={t.name}
                      title={`${t.name} · ${DESIGN_NAMES[t.design]}`}
                    >
                      <span
                        className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                        style={{ background: lookSwatch(t) }}
                        aria-hidden
                      />
                    </OptionCard>
                    <button
                      type="button"
                      onClick={() => deleteNamedTheme(t.id)}
                      aria-label={`Delete ${t.name}`}
                      className="absolute top-1 right-1 rounded-md bg-background/70 px-1 text-xs text-fg/50 opacity-0 transition-opacity group-hover/theme:opacity-100 hover:text-red-400 focus-visible:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "colors" && (
        <div
          role="tabpanel"
          id="tb-panel-colors"
          aria-labelledby="tb-tab-colors"
          className="space-y-5"
        >
          <div className="space-y-2">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.15em] text-fg/45 uppercase">
                Palettes
              </span>
              <p className="text-xs text-fg/40">
                Ready-made color sets — one tap recolors both modes (each swatch
                shows its dark and light halves).
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
              {BASE_THEMES.map((t) => (
                <OptionCard
                  key={t.name}
                  onClick={() => applyThemeColors(t)}
                  name={t.name}
                  title={t.name}
                >
                  <PaletteSwatch look={t} />
                </OptionCard>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t border-fg/10 pt-4">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.15em] text-fg/45 uppercase">
                Custom
              </span>
              <p className="text-xs text-fg/40">
                Or pick each color yourself — changes apply instantly.
              </p>
            </div>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="block text-[11px] font-medium text-fg/55">
                  Surface — {editMode} theme only
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {BASE_FIELDS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-fg/10 bg-fg/5 p-2 transition-colors hover:border-fg/25"
                    >
                      <input
                        type="color"
                        value={draft[key]}
                        onChange={(e) => updateBase(key, e.target.value)}
                        aria-label={label}
                        className="color-well h-9 w-9 shrink-0 cursor-pointer rounded-full"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-fg/75">
                          {label}
                        </span>
                        <span className="block font-mono text-[10px] text-fg/40 uppercase">
                          {draft[key]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {/* Live sample of the mode being edited, so even the half you're
                    not looking at gets feedback as you pick. */}
                <div
                  className="flex h-11 items-center justify-between overflow-hidden rounded-lg px-3 ring-1 ring-fg/10"
                  style={{
                    background: `radial-gradient(120% 150% at 80% -30%, ${draft.accentFrom}, transparent 55%), ${draft.background}`,
                  }}
                >
                  <span
                    className="text-xs font-medium capitalize"
                    style={{ color: draft.foreground }}
                  >
                    {editMode} preview · Aa
                  </span>
                  <span
                    className="h-1.5 w-12 shrink-0 rounded-full"
                    style={{
                      backgroundImage: `linear-gradient(to right, ${draft.accentFrom}, ${draft.accentTo})`,
                    }}
                    aria-hidden
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-fg/55">
                    Accent — {editMode} theme only
                  </span>
                  <div className="flex overflow-hidden rounded-md border border-fg/10">
                    {(["gradient", "solid"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => chooseAccentStyle(s)}
                        aria-pressed={accentStyle === s}
                        className={`px-2.5 py-1 text-[10px] capitalize transition-colors ${
                          accentStyle === s
                            ? "bg-fg/15 text-fg"
                            : "text-fg/50 hover:text-fg/80"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                {/* The accent editor IS the gradient: a bar with a color well at
                    each end (or one centered well when solid). */}
                <div
                  className="relative h-11 rounded-full ring-1 ring-fg/10"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${draft.accentFrom}, ${draft.accentTo})`,
                  }}
                >
                  <input
                    type="color"
                    value={draft.accentFrom}
                    onChange={(e) => updateAccent("accentFrom", e.target.value)}
                    aria-label={
                      accentStyle === "solid"
                        ? "Accent color"
                        : "Accent start color"
                    }
                    className={`color-well absolute top-1/2 h-7 w-7 -translate-y-1/2 cursor-pointer rounded-full shadow-md ${
                      accentStyle === "solid"
                        ? "left-1/2 -translate-x-1/2"
                        : "left-2"
                    }`}
                  />
                  {accentStyle === "gradient" && (
                    <input
                      type="color"
                      value={draft.accentTo}
                      onChange={(e) => updateAccent("accentTo", e.target.value)}
                      aria-label="Accent end color"
                      className="color-well absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 cursor-pointer rounded-full shadow-md"
                    />
                  )}
                </div>
                <div
                  className={`flex font-mono text-[10px] text-fg/40 uppercase ${
                    accentStyle === "gradient"
                      ? "justify-between"
                      : "justify-center"
                  }`}
                >
                  <span>{draft.accentFrom}</span>
                  {accentStyle === "gradient" && <span>{draft.accentTo}</span>}
                </div>
                <p className="text-xs text-fg/40">
                  Colors buttons, highlights &amp; the scene glow.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "design" && (
        <div
          role="tabpanel"
          id="tb-panel-design"
          aria-labelledby="tb-tab-design"
          className="space-y-3"
        >
          <p className="text-xs text-fg/40">
            How cards &amp; panels are drawn — the surface style of your{" "}
            {editMode} theme.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {DESIGNS.map((d) => (
              <OptionCard
                key={d.id}
                selected={designFor(editMode) === d.id}
                onClick={() => setDesign(d.id, editMode)}
                name={d.name}
                desc={d.description}
                title={d.description}
              >
                <span
                  className={`pointer-events-none block ${d.id === "glass" ? "" : `design-${d.id}`}`}
                >
                  <span className="glass-card flex h-10 w-full items-center justify-center">
                    <span
                      className="h-1.5 w-9 rounded-full"
                      style={{
                        backgroundImage: `linear-gradient(to right, ${activeAccent.from}, ${activeAccent.to})`,
                      }}
                      aria-hidden
                    />
                  </span>
                </span>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {tab === "scene" && (
        <div
          role="tabpanel"
          id="tb-panel-scene"
          aria-labelledby="tb-tab-scene"
          className="space-y-3"
        >
          <p className="text-xs text-fg/40">
            The animated backdrop behind your {editMode} theme.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SCENES.map((s) => (
              <OptionCard
                key={s.id}
                selected={sceneFor(editMode) === s.id}
                onClick={() => setScene(s.id, editMode)}
                name={s.name}
                desc={s.description}
                title={s.description}
              >
                <span
                  className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                  style={{
                    background: scenePreview(s.id, sceneFrom, sceneTo),
                  }}
                  aria-hidden
                />
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {tab === "font" && (
        <div
          role="tabpanel"
          id="tb-panel-font"
          aria-labelledby="tb-tab-font"
          className="space-y-3"
        >
          <p className="text-xs text-fg/40">
            The interface typeface of your {editMode} theme.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {FONTS.map((f) => (
              <OptionCard
                key={f.id}
                selected={fontFor(editMode) === f.id}
                onClick={() => setFont(f.id, editMode)}
                name={f.name}
                title={f.name}
                nameStyle={{ fontFamily: fontVar(f.id) }}
              >
                <span
                  className="block text-2xl leading-tight text-fg/90"
                  style={{ fontFamily: fontVar(f.id) }}
                  aria-hidden
                >
                  Ag
                </span>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-fg/10 pt-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveTheme()}
          placeholder="Name this look to save it — both modes included"
          className="accent-focus min-w-0 flex-1 basis-56 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
        />
        <button
          type="button"
          onClick={saveTheme}
          disabled={!name.trim()}
          className={`${buttonClasses("primary")} shrink-0`}
        >
          Save theme
        </button>
        <button
          type="button"
          onClick={resetTheme}
          title="Return the theme to the app default"
          className={`${buttonClasses("ghost")} shrink-0`}
        >
          Reset theme
        </button>
      </div>
    </div>
  );
}
