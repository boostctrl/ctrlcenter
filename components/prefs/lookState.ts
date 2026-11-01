"use client";

// The visitor's look state (useLook) and its live mirror. React state is what
// renders read; the mirror is what every paint reads, written by the setter
// before React commits. A handler that calls several setters in one click
// then paints each from the values the earlier ones just set, not from the
// render's closure — the bug behind #363, #373, #394 and #429, which each
// setter used to dodge with a part passed alongside the paint.
import { useCallback, useRef, useState } from "react";
import {
  NO_ACCENT_OVERRIDES,
  type AccentOverrides,
  type HeadingChoice,
  type ModePair,
  type WallpaperChoice,
} from "@/lib/prefs";
import type {
  Density,
  DesignId,
  ModeColors,
  SceneFx,
  SceneId,
  SemanticColors,
  Tune,
} from "@/lib/theme";
import type { FontId } from "@/lib/fonts";
import type { Mode, Theme } from "./themeApply";

// Everything a paint reads: the saved mode and a builder preview of another,
// each per-mode part the visitor chose (null = the site default), the custom
// colors and the standalone accents.
export type LookState = {
  theme: Theme;
  previewMode: Mode | null;
  designs: ModePair<DesignId | null>;
  scenes: ModePair<SceneId | null>;
  fonts: ModePair<FontId | null>;
  tunes: ModePair<Tune | null>;
  sceneFxs: ModePair<SceneFx | null>;
  reduceMotion: boolean;
  headings: ModePair<HeadingChoice | null>;
  densities: ModePair<Density | null>;
  statuses: ModePair<SemanticColors | null>;
  wallpapers: ModePair<WallpaperChoice | null>;
  activeLook: ModeColors | null;
  accentOverride: AccentOverrides;
};

// No visitor choice for either mode.
export const NO_CHOICE: ModePair<null> = { dark: null, light: null };

// The look before anything stored is read: the site's mode, nothing chosen.
export function initialLookState(mode: Theme): LookState {
  return {
    theme: mode,
    previewMode: null,
    designs: NO_CHOICE,
    scenes: NO_CHOICE,
    fonts: NO_CHOICE,
    tunes: NO_CHOICE,
    sceneFxs: NO_CHOICE,
    reduceMotion: false,
    headings: NO_CHOICE,
    densities: NO_CHOICE,
    statuses: NO_CHOICE,
    wallpapers: NO_CHOICE,
    activeLook: null,
    accentOverride: NO_ACCENT_OVERRIDES,
  };
}

// The visitor's choice of a per-mode part for a mode.
export function forMode<T>(pair: ModePair<T>, dark: boolean): T {
  return dark ? pair.dark : pair.light;
}

// The slices to write: given outright, or built from the latest state (for a
// per-mode part, which keeps the other mode's choice).
export type LookPatch = Partial<LookState> | ((latest: LookState) => Partial<LookState>);
// Writes the patch to the mirror and to React state; returns the state it made.
export type UpdateLook = (patch: LookPatch) => LookState;

export function useLookState(initial: LookState): {
  state: LookState;
  // The latest state: every write lands here first, so a paint in the same
  // handler as an earlier setter sees that setter's value. A reader rather
  // than the ref, so a caller's callbacks depend on one stable function.
  latest: () => LookState;
  update: UpdateLook;
} {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const latest = useCallback(() => ref.current, []);
  const update = useCallback<UpdateLook>((patch) => {
    const next: LookState = {
      ...ref.current,
      ...(typeof patch === "function" ? patch(ref.current) : patch),
    };
    ref.current = next;
    setState(next);
    return next;
  }, []);
  return { state, latest, update };
}
