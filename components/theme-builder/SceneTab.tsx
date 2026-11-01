"use client";

import {
  DEFAULT_SCENE_FX,
  MOTION_LEVELS,
  SCENES,
  isDefaultSceneFx,
  type MotionLevel,
  type SceneId,
} from "@/lib/theme";
import { ChipGroup } from "../ChipGroup";
import { buttonClasses } from "@/lib/buttons";
import { OptionCard } from "./OptionCard";
import { SectionHeading } from "./SectionHeading";
import { SCENE_ROWS } from "./sceneFamilies";
import { scenePreview } from "./scenePreview";
import { WallpaperFields } from "./WallpaperFields";
import type { ThemeDraft } from "./useThemeDraft";

// The Scene tab, in three blocks: the scene in use with its own controls
// (intensity, motion, off), the scenes to pick from in labelled family rows
// (sceneFamilies.ts), and the wallpaper behind it. Each block is a labelled
// region, so a screen reader hears which set a tile belongs to (#350).
export default function SceneTab({ d, canUpload = false }: { d: ThemeDraft; canUpload?: boolean }) {
  const {
    sceneFor,
    setScene,
    sceneFxFor,
    setSceneFx,
    wallpaperFor,
    setWallpaper,
    editMode,
    sceneFrom,
    sceneTo,
  } = d;
  const fx = sceneFxFor(editMode) ?? DEFAULT_SCENE_FX;
  const scene = sceneFor(editMode);
  const current = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  // The scene as designed is an explicit "none", so it holds even when the
  // site default calms or dims the scene (#395).
  const update = (patch: Partial<typeof fx>) => {
    const next = { ...fx, ...patch };
    setSceneFx(isDefaultSceneFx(next) ? "none" : next, editMode);
  };
  const swatch = (id: SceneId, tall = false) => (
    <span
      className={`block w-full overflow-hidden rounded-md ring-1 ring-fg/10 ${tall ? "h-full" : "h-10"}`}
      style={{ background: scenePreview(id, sceneFrom, sceneTo) }}
      aria-hidden
    />
  );
  const intensityId = `tb-scene-intensity-${editMode}`;
  return (
    <div
      role="tabpanel"
      id="tb-panel-scene"
      aria-labelledby="tb-tab-scene"
      className="space-y-6"
    >
      {/* What's behind the page now, and its own controls (#327): how
          strongly it shows and how much it moves, for the mode being edited,
          saved with the theme. */}
      <section aria-labelledby="tb-scene-current" className="space-y-3">
        <SectionHeading id="tb-scene-current" eyebrow="Scene">
          The animated backdrop behind your {editMode} theme.
        </SectionHeading>
        <div className="grid gap-x-6 gap-y-3 rounded-lg border border-fg/10 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-12 w-20 shrink-0">{swatch(current.id, true)}</span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-ink-90">{current.name}</span>
                <span className="rounded bg-fg/10 px-1.5 text-[9px] font-medium tracking-wide text-ink-60 uppercase">
                  {current.id === "none" ? "Off" : current.still ? "Still" : "Animated"}
                </span>
              </span>
              <span className="block text-xs text-ink-50">{current.description}</span>
            </span>
          </div>
          {current.id === "none" ? (
            <p className="text-xs text-ink-40 sm:text-right">Pick a scene below to put one behind the page.</p>
          ) : (
            <button
              type="button"
              onClick={() => setScene("none", editMode)}
              className={`${buttonClasses("ghost", "sm")} w-fit`}
            >
              Turn the scene off
            </button>
          )}
          {current.id !== "none" && (
            <div className="grid gap-x-6 gap-y-3 border-t border-fg/10 pt-3 sm:col-span-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={intensityId} className="text-[11px] font-medium text-ink-55">
                    Intensity
                  </label>
                  <output htmlFor={intensityId} className="font-mono text-[10px] text-ink-40 tabular-nums">
                    {fx.intensity}%
                  </output>
                </div>
                <input
                  id={intensityId}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={fx.intensity}
                  onChange={(e) => update({ intensity: Number(e.target.value) })}
                  className="tune-range w-full"
                />
                <p className="text-[10px] text-ink-40">How strongly the backdrop shows through.</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium text-ink-55">Motion</span>
                  {!isDefaultSceneFx(sceneFxFor(editMode)) && (
                    <button
                      type="button"
                      onClick={() => setSceneFx("none", editMode)}
                      className="text-[10px] text-ink-50 underline underline-offset-2 transition-colors hover:text-fg"
                    >
                      Reset to the scene
                    </button>
                  )}
                </div>
                {current.still ? (
                  <p className="text-xs text-ink-50">This scene never moves.</p>
                ) : (
                  <ChipGroup
                    label="Scene motion"
                    size="xs"
                    fit
                    options={MOTION_LEVELS.map((m) => ({ value: m.id, label: m.name }))}
                    value={fx.motion}
                    onChange={(motion: MotionLevel) => update({ motion })}
                  />
                )}
                <p className="text-[10px] text-ink-40">
                  {current.still
                    ? "Your Reduce motion preference stills every other scene regardless."
                    : `${MOTION_LEVELS.find((m) => m.id === fx.motion)?.description}. Your Reduce motion preference stills every scene regardless.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* The scenes to pick from, a labelled row per family so the set can
          be scanned by kind, each row in registry order. */}
      <section aria-labelledby="tb-scene-pick" className="space-y-4">
        <SectionHeading id="tb-scene-pick" eyebrow="Choose a scene">
          Every scene recolours with your palette. Still scenes never move.
        </SectionHeading>
        {SCENE_ROWS.map((row) => {
          const labelId = `tb-scene-family-${row.id}`;
          return (
            <div key={row.id} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span id={labelId} className="text-xs font-medium text-ink-70">
                  {row.name}
                </span>
                <span className="text-[10px] text-ink-40">{row.description}</span>
              </div>
              <div
                role="group"
                aria-labelledby={labelId}
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
              >
                {row.scenes.map((s) => (
                  <OptionCard
                    key={s.id}
                    selected={scene === s.id}
                    onClick={() => setScene(s.id, editMode)}
                    name={s.name}
                    desc={s.description}
                    title={s.description}
                    badge={s.still ? "Still" : undefined}
                  >
                    {swatch(s.id)}
                  </OptionCard>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* A wallpaper (#333): an image behind the scene for the mode being
          edited, saved with the theme. Removing it hides an admin default
          wallpaper too. */}
      <section aria-labelledby="tb-scene-wallpaper" className="space-y-3 border-t border-fg/10 pt-5">
        <SectionHeading id="tb-scene-wallpaper" eyebrow="Wallpaper">
          An image behind the scene, blurred and dimmed to taste: a bundled pattern, a photo by
          its web address{canUpload ? ", or an upload" : ""}.
        </SectionHeading>
        <WallpaperFields
          value={wallpaperFor(editMode)}
          onChange={(wp) => setWallpaper(wp ?? "none", editMode)}
          idPrefix={`tb-wallpaper-${editMode}`}
          canUpload={canUpload}
        />
      </section>
    </div>
  );
}
