"use client";

import { ChipGroup } from "../ChipGroup";
import { BASE_THEMES } from "@/lib/theme";
import type { ModeColors } from "@/lib/theme";
import { BASE_FIELDS } from "./constants";
import { OptionCard } from "./OptionCard";
import type { ThemeDraft } from "./useThemeDraft";

// Palettes recolor BOTH modes at once, so their swatch shows both halves —
// dark surface left, light surface right, each with its ink — over an accent
// strip that blends from the dark half's accent pair into the light half's.
function PaletteSwatch({ look }: { look: ModeColors }) {
  return (
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
}

export default function ColorsTab({ d }: { d: ThemeDraft }) {
  const {
    applyThemeColors,
    editMode,
    draft,
    accentStyle,
    updateBase,
    updateAccent,
    chooseAccentStyle,
  } = d;
  return (
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
              <ChipGroup
                label="Accent style"
                size="2xs"
                rounded="md"
                capitalize
                options={(["gradient", "solid"] as const).map((s) => ({
                  value: s,
                  label: s,
                }))}
                value={accentStyle}
                onChange={chooseAccentStyle}
              />
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
  );
}
