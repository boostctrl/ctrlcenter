"use client";

import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  saveThemes,
  saveDesign,
  saveScene,
  saveFont,
  newThemeId,
  type CustomTheme,
  type AccentOverrides,
  type ModePair,
} from "@/lib/prefs";
import type { ColorSet, DesignId, ModeColors, SceneFx, SceneId, Tune } from "@/lib/theme";
import type { FontId } from "@/lib/fonts";
import {
  applyDesign,
  applyFont,
  applyScene,
  overrideFor,
  resolveAccent,
  resolveDark,
  type Accent,
  type Mode,
  type Theme,
} from "./themeApply";

// The visitor's saved (named) themes: the list itself and its CRUD — save the
// current look, restore one, rename, delete, import. The live look these read
// and write (colors, per-mode design/scene/font) stays in PrefsProvider and is
// passed in, so restoring a theme goes through the same state as any edit.
export function useSavedThemes({
  activeLook,
  seedColorSet,
  accentOverride,
  defaultAccent,
  resolveDesign,
  resolveScene,
  resolveFont,
  resolveTune,
  setTune,
  resolveSceneFx,
  setSceneFx,
  applyThemeColors,
  displayTheme,
  setDesigns,
  setScenes,
  setFonts,
}: {
  activeLook: ModeColors | null;
  seedColorSet: (dark: boolean) => ColorSet;
  accentOverride: AccentOverrides;
  defaultAccent: Accent;
  resolveDesign: (dark: boolean) => DesignId;
  resolveScene: (dark: boolean) => SceneId;
  resolveFont: (dark: boolean) => FontId;
  resolveTune: (dark: boolean) => Tune | null;
  setTune: (tune: Tune | null, mode: Mode) => void;
  resolveSceneFx: (dark: boolean) => SceneFx | null;
  setSceneFx: (fx: SceneFx | null, mode: Mode) => void;
  applyThemeColors: (colors: ModeColors, mode?: Mode) => void;
  displayTheme: Theme;
  setDesigns: Dispatch<SetStateAction<ModePair<DesignId | null>>>;
  setScenes: Dispatch<SetStateAction<ModePair<SceneId | null>>>;
  setFonts: Dispatch<SetStateAction<ModePair<FontId | null>>>;
}) {
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);

  // Persist-before-commit for every saved-themes mutation: a list that can't
  // be stored would vanish on reload, so state only advances (and true is only
  // returned) when the write lands.
  const commitThemes = useCallback((next: CustomTheme[]) => {
    if (!saveThemes(next)) return false;
    setCustomThemes(next);
    return true;
  }, []);

  // Capture the current full look — both modes' design/scene/font and colors —
  // as a saved theme, baking each mode's effective accent into its colorset so it
  // restores exactly as shown.
  const saveNamedTheme = useCallback(
    (name: string, overwriteId?: string) => {
      const look =
        activeLook ?? { dark: seedColorSet(true), light: seedColorSet(false) };
      // Bake each mode's own effective accent into its colorset.
      const withAccent = (cs: ColorSet, dark: boolean): ColorSet => {
        const a = resolveAccent(overrideFor(accentOverride, dark), cs, defaultAccent);
        return { ...cs, accentFrom: a.from, accentTo: a.to };
      };
      // Overwriting keeps the target's id (and its slot in the list); everything
      // else — name and both modes' design/scene/font/colors — is recaptured
      // fresh, exactly as a new save would.
      const existing = overwriteId
        ? customThemes.find((t) => t.id === overwriteId)
        : undefined;
      const entry: CustomTheme = {
        id: existing ? existing.id : newThemeId(),
        name: name.trim().slice(0, 40) || "Custom",
        design: resolveDesign(true),
        scene: resolveScene(true),
        font: resolveFont(true),
        designLight: resolveDesign(false),
        sceneLight: resolveScene(false),
        fontLight: resolveFont(false),
        dark: withAccent(look.dark, true),
        light: withAccent(look.light, false),
      };
      // The fine-tune over each mode's design, when there is one (#326).
      const tune = resolveTune(true);
      const tuneLight = resolveTune(false);
      if (tune) entry.tune = tune;
      if (tuneLight) entry.tuneLight = tuneLight;
      // And each mode's scene effects (#327).
      const fx = resolveSceneFx(true);
      const fxLight = resolveSceneFx(false);
      if (fx) entry.sceneFx = fx;
      if (fxLight) entry.sceneFxLight = fxLight;
      return commitThemes(
        existing
          ? customThemes.map((t) => (t.id === existing.id ? entry : t))
          : [...customThemes, entry]
      );
    },
    [
      customThemes,
      commitThemes,
      activeLook,
      seedColorSet,
      accentOverride,
      defaultAccent,
      resolveDesign,
      resolveScene,
      resolveFont,
      resolveTune,
      resolveSceneFx,
    ]
  );

  // Restore a saved theme: both modes' design/scene/font and colors, then apply
  // the chrome for whichever mode is displayed now — from the theme's own parts,
  // not applyChrome, which would resolve from this render's designs/scenes/fonts
  // state (the values from before the setState calls above commit) and re-apply
  // the old chrome until a mode toggle or reload (#120).
  const applyNamedTheme = useCallback(
    (id: string) => {
      const t = customThemes.find((x) => x.id === id);
      if (!t) return;
      const nextDesigns = { dark: t.design, light: t.designLight };
      const nextScenes = { dark: t.scene, light: t.sceneLight };
      const nextFonts = { dark: t.font, light: t.fontLight };
      setDesigns(nextDesigns);
      saveDesign(nextDesigns);
      setScenes(nextScenes);
      saveScene(nextScenes);
      setFonts(nextFonts);
      saveFont(nextFonts);
      // Each mode's tune (null = the design untouched); setTune paints the
      // displayed mode's one itself.
      setTune(t.tune ?? null, "dark");
      setTune(t.tuneLight ?? null, "light");
      setSceneFx(t.sceneFx ?? null, "dark");
      setSceneFx(t.sceneFxLight ?? null, "light");
      applyThemeColors({ dark: t.dark, light: t.light });
      const dark = resolveDark(displayTheme);
      applyDesign(dark ? t.design : t.designLight);
      applyScene(dark ? t.scene : t.sceneLight);
      applyFont(dark ? t.font : t.fontLight);
    },
    // The setters are PrefsProvider's useState setters — stable, listed only
    // because they arrive as arguments here.
    [customThemes, applyThemeColors, displayTheme, setDesigns, setScenes, setFonts, setTune, setSceneFx]
  );

  const deleteNamedTheme = useCallback((id: string) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveThemes(next);
      return next;
    });
  }, []);

  // Rename one saved theme in place, leaving the rest of its look untouched.
  const renameNamedTheme = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed || !customThemes.some((t) => t.id === id)) return false;
      return commitThemes(
        customThemes.map((t) => (t.id === id ? { ...t, name: trimmed } : t))
      );
    },
    [customThemes, commitThemes]
  );

  // Append imported themes (already sanitized by parseThemesExport), skipping
  // any that duplicate one already saved or an earlier one in the same import.
  // Ids differ by construction, so de-dupe on content with the id excluded —
  // field by field, not JSON of the whole object, so the key can't silently
  // start depending on key insertion order across the places themes are built.
  const importNamedThemes = useCallback(
    (themes: CustomTheme[]) => {
      const colorKey = (c: ColorSet) => [
        c.background,
        c.foreground,
        c.accentFrom,
        c.accentTo,
      ];
      const keyOf = (t: CustomTheme) =>
        JSON.stringify([
          t.name,
          t.design,
          t.scene,
          t.font,
          t.designLight,
          t.sceneLight,
          t.fontLight,
          colorKey(t.dark),
          colorKey(t.light),
          t.tune ?? null,
          t.tuneLight ?? null,
          t.sceneFx ?? null,
          t.sceneFxLight ?? null,
        ]);
      const seen = new Set(customThemes.map(keyOf));
      const added: CustomTheme[] = [];
      for (const t of themes) {
        const key = keyOf(t);
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(t);
      }
      // Nothing new: the stored list is already correct, so this is a success
      // with a zero count, not a storage failure.
      if (added.length === 0) return 0;
      return commitThemes([...customThemes, ...added]) ? added.length : null;
    },
    [customThemes, commitThemes]
  );

  return {
    customThemes,
    setCustomThemes,
    saveNamedTheme,
    applyNamedTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
  };
}
