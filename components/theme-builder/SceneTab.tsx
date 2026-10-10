"use client";

import { DEFAULT_SCENE_FX, MOTION_LEVELS, SCENES, isDefaultSceneFx, type MotionLevel } from "@/lib/theme";
import { ChipGroup } from "../ChipGroup";
import { buttonClasses } from "@/lib/buttons";
import { OptionCard } from "./OptionCard";
import { scenePreview } from "./scenePreview";
import { WallpaperFields } from "./WallpaperFields";
import type { ThemeDraft } from "./useThemeDraft";

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
  const update = (patch: Partial<typeof fx>) => {
    const next = { ...fx, ...patch };
    setSceneFx(isDefaultSceneFx(next) ? null : next, editMode);
  };
  return (
    <div
      role="tabpanel"
      id="tb-panel-scene"
      aria-labelledby="tb-tab-scene"
      className="space-y-3"
    >
      <p className="text-xs text-ink-40">
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

      {/* Intensity and motion (#327): how strongly the scene shows and how
          much it moves, for the mode being edited; saved with the theme. */}
      {scene !== "none" && (
        <div className="grid gap-x-6 gap-y-4 border-t border-fg/10 pt-4 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`tb-scene-intensity-${editMode}`} className="text-[11px] font-medium text-ink-55">
                Intensity
              </label>
              <output htmlFor={`tb-scene-intensity-${editMode}`} className="font-mono text-[10px] text-ink-40 tabular-nums">
                {fx.intensity}%
              </output>
            </div>
            <input
              id={`tb-scene-intensity-${editMode}`}
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
            <span className="block text-[11px] font-medium text-ink-55">Motion</span>
            <ChipGroup
              label="Scene motion"
              size="xs"
              fit
              options={MOTION_LEVELS.map((m) => ({ value: m.id, label: m.name }))}
              value={fx.motion}
              onChange={(motion: MotionLevel) => update({ motion })}
            />
            <p className="text-[10px] text-ink-40">
              {MOTION_LEVELS.find((m) => m.id === fx.motion)?.description}. Your Reduce
              motion preference stills every scene regardless.
            </p>
          </div>
          {!isDefaultSceneFx(sceneFxFor(editMode)) && (
            <div className="sm:col-span-2">
              <button type="button" onClick={() => setSceneFx(null, editMode)} className={buttonClasses("ghost", "sm")}>
                Reset to the scene
              </button>
            </div>
          )}
        </div>
      )}

      {/* A wallpaper (#333): a photo behind the scene for the mode being
          edited, saved with the theme. Removing it hides an admin default
          wallpaper too. */}
      <div className="space-y-3 border-t border-fg/10 pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-55">Wallpaper</h3>
        <WallpaperFields
          value={wallpaperFor(editMode)}
          onChange={(wp) => setWallpaper(wp ?? "none", editMode)}
          idPrefix={`tb-wallpaper-${editMode}`}
          canUpload={canUpload}
        />
      </div>
    </div>
  );
}
