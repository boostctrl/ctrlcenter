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
  saveTune,
  saveSceneFx,
  saveHeadingFont,
  saveDensity,
  saveStatusColors,
  newThemeId,
  NO_ACCENT_OVERRIDES,
  type HeadingChoice,
  type CustomTheme,
  type AccentOverrides,
  type ModePair,
} from "@/lib/prefs";
import type { ColorSet, Density, DesignId, ModeColors, SceneFx, SceneId, SemanticColors, Tune } from "@/lib/theme";
import type { FontId } from "@/lib/fonts";
import {
  applyAll as paintAll,
  applyDesign,
  applyFont,
  applyHeadingFont,
  applyScene,
  overrideFor,
  resolveAccent,
  resolveDark,
  type Accent,
  type Mode,
  type Theme,
} from "./themeApply";

// A theme's content, id excluded — field by field, not JSON of the whole
// object, so the key can't silently start depending on key insertion order
// across the places themes are built. Imports de-dupe on it.
function themeKey(t: CustomTheme): string {
  const colorKey = (c: ColorSet) => [c.background, c.foreground, c.accentFrom, c.accentTo];
  return JSON.stringify([
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
    t.headingFont ?? null,
    t.headingFontLight ?? null,
    t.density ?? null,
    t.densityLight ?? null,
    t.status ?? null,
    t.statusLight ?? null,
  ]);
}

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
  defTune,
  resolveSceneFx,
  defSceneFx,
  applyThemeColors,
  displayTheme,
  setDesigns,
  setScenes,
  setFonts,
  setTunes,
  setSceneFxs,
  reduceMotion,
  resolveHeading,
  resolveDensity,
  setHeadings,
  setDensities,
  resolveStatus,
  setStatuses,
}: {
  activeLook: ModeColors | null;
  seedColorSet: (dark: boolean) => ColorSet;
  accentOverride: AccentOverrides;
  defaultAccent: Accent;
  resolveDesign: (dark: boolean) => DesignId;
  resolveScene: (dark: boolean) => SceneId;
  resolveFont: (dark: boolean) => FontId;
  resolveTune: (dark: boolean) => Tune | null;
  defTune: (dark: boolean) => Tune | null;
  resolveSceneFx: (dark: boolean) => SceneFx | null;
  defSceneFx: (dark: boolean) => SceneFx | null;
  applyThemeColors: (colors: ModeColors, mode?: Mode) => void;
  displayTheme: Theme;
  setDesigns: Dispatch<SetStateAction<ModePair<DesignId | null>>>;
  setScenes: Dispatch<SetStateAction<ModePair<SceneId | null>>>;
  setFonts: Dispatch<SetStateAction<ModePair<FontId | null>>>;
  setTunes: Dispatch<SetStateAction<ModePair<Tune | null>>>;
  setSceneFxs: Dispatch<SetStateAction<ModePair<SceneFx | null>>>;
  reduceMotion: boolean;
  resolveHeading: (dark: boolean) => FontId | null;
  resolveDensity: (dark: boolean) => Density;
  setHeadings: Dispatch<SetStateAction<ModePair<HeadingChoice | null>>>;
  setDensities: Dispatch<SetStateAction<ModePair<Density | null>>>;
  resolveStatus: (dark: boolean) => SemanticColors | null;
  setStatuses: Dispatch<SetStateAction<ModePair<SemanticColors | null>>>;
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

  // Capture the current full look — both modes' design/scene/font, colors,
  // tune and scene effects — as a theme object, baking each mode's effective
  // accent into its colorset so it restores exactly as shown. Saving stores
  // it; "Copy as code" (#329) encodes it without storing.
  const captureTheme = useCallback(
    (name: string, id: string): CustomTheme => {
      const look =
        activeLook ?? { dark: seedColorSet(true), light: seedColorSet(false) };
      const withAccent = (cs: ColorSet, dark: boolean): ColorSet => {
        const a = resolveAccent(overrideFor(accentOverride, dark), cs, defaultAccent);
        return { ...cs, accentFrom: a.from, accentTo: a.to };
      };
      const entry: CustomTheme = {
        id,
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
      const tune = resolveTune(true);
      const tuneLight = resolveTune(false);
      if (tune) entry.tune = tune;
      if (tuneLight) entry.tuneLight = tuneLight;
      const fx = resolveSceneFx(true);
      const fxLight = resolveSceneFx(false);
      if (fx) entry.sceneFx = fx;
      if (fxLight) entry.sceneFxLight = fxLight;
      // Typography (#330): the heading face when one is set, the density
      // when it isn't the default.
      const heading = resolveHeading(true);
      const headingLight = resolveHeading(false);
      if (heading) entry.headingFont = heading;
      if (headingLight) entry.headingFontLight = headingLight;
      const density = resolveDensity(true);
      const densityLight = resolveDensity(false);
      if (density !== "comfortable") entry.density = density;
      if (densityLight !== "comfortable") entry.densityLight = densityLight;
      // Semantic colors (#331), when a mode has its own.
      const status = resolveStatus(true);
      const statusLight = resolveStatus(false);
      if (status) entry.status = status;
      if (statusLight) entry.statusLight = statusLight;
      return entry;
    },
    [
      activeLook,
      seedColorSet,
      accentOverride,
      defaultAccent,
      resolveDesign,
      resolveScene,
      resolveFont,
      resolveTune,
      resolveSceneFx,
      resolveHeading,
      resolveDensity,
      resolveStatus,
    ]
  );

  const saveNamedTheme = useCallback(
    (name: string, overwriteId?: string) => {
      // Overwriting keeps the target's id (and its slot in the list); everything
      // else — name and both modes' parts — is recaptured fresh, exactly as a
      // new save would.
      const existing = overwriteId
        ? customThemes.find((t) => t.id === overwriteId)
        : undefined;
      const entry = captureTheme(name, existing ? existing.id : newThemeId());
      return commitThemes(
        existing
          ? customThemes.map((t) => (t.id === existing.id ? entry : t))
          : [...customThemes, entry]
      );
    },
    [customThemes, commitThemes, captureTheme]
  );

  // Restore a saved theme: both modes' design/scene/font and colors, then apply
  // the chrome for whichever mode is displayed now — from the theme's own parts,
  // not applyChrome, which would resolve from this render's designs/scenes/fonts
  // state (the values from before the setState calls above commit) and re-apply
  // the old chrome until a mode toggle or reload (#120).
  const applyTheme = useCallback(
    (t: CustomTheme) => {
      const nextDesigns = { dark: t.design, light: t.designLight };
      const nextScenes = { dark: t.scene, light: t.sceneLight };
      const nextFonts = { dark: t.font, light: t.fontLight };
      setDesigns(nextDesigns);
      saveDesign(nextDesigns);
      setScenes(nextScenes);
      saveScene(nextScenes);
      setFonts(nextFonts);
      saveFont(nextFonts);
      const nextTunes = { dark: t.tune ?? null, light: t.tuneLight ?? null };
      setTunes(nextTunes);
      saveTune(nextTunes);
      const nextFx = { dark: t.sceneFx ?? null, light: t.sceneFxLight ?? null };
      setSceneFxs(nextFx);
      saveSceneFx(nextFx);
      // A saved theme without a heading face means the body font — "body",
      // so an admin default heading face doesn't show through it.
      const nextHeadings: ModePair<HeadingChoice | null> = {
        dark: t.headingFont ?? "body",
        light: t.headingFontLight ?? "body",
      };
      setHeadings(nextHeadings);
      saveHeadingFont(nextHeadings);
      const nextDensities: ModePair<Density | null> = {
        dark: t.density ?? "comfortable",
        light: t.densityLight ?? "comfortable",
      };
      setDensities(nextDensities);
      saveDensity(nextDensities);
      const nextStatuses: ModePair<SemanticColors | null> = {
        dark: t.status ?? null,
        light: t.statusLight ?? null,
      };
      setStatuses(nextStatuses);
      saveStatusColors(nextStatuses);
      applyThemeColors({ dark: t.dark, light: t.light });
      const dark = resolveDark(displayTheme);
      // applyThemeColors painted with this render's tune and effects (the
      // state above hasn't committed); paint once more with the theme's own,
      // so a restored tune isn't wiped until the next repaint (#329).
      paintAll({
        theme: displayTheme,
        look: { dark: t.dark, light: t.light },
        accentOverride: NO_ACCENT_OVERRIDES,
        defaultAccent,
        tune: (dark ? t.tune : t.tuneLight) ?? defTune(dark),
        sceneFx: (dark ? t.sceneFx : t.sceneFxLight) ?? defSceneFx(dark),
        reduceMotion,
        density: (dark ? t.density : t.densityLight) ?? "comfortable",
        status: (dark ? t.status : t.statusLight) ?? null,
      });
      applyDesign(dark ? t.design : t.designLight);
      applyScene(dark ? t.scene : t.sceneLight);
      applyFont(dark ? t.font : t.fontLight);
      applyHeadingFont((dark ? t.headingFont : t.headingFontLight) ?? null);
    },
    // The setters are PrefsProvider's useState setters — stable, listed only
    // because they arrive as arguments here.
    [
      applyThemeColors,
      displayTheme,
      defaultAccent,
      defTune,
      defSceneFx,
      reduceMotion,
      setDesigns,
      setScenes,
      setFonts,
      setTunes,
      setSceneFxs,
      setHeadings,
      setDensities,
      setStatuses,
    ]
  );

  const applyNamedTheme = useCallback(
    (id: string) => {
      const t = customThemes.find((x) => x.id === id);
      if (t) applyTheme(t);
    },
    [customThemes, applyTheme]
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
      const seen = new Set(customThemes.map(themeKey));
      const added: CustomTheme[] = [];
      for (const t of themes) {
        const key = themeKey(t);
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

  // Take in a theme from a code or link (#329): save it unless an identical
  // one is already saved, then apply it. Returns the theme now in the list,
  // or null when it couldn't be stored.
  const adoptTheme = useCallback(
    (t: CustomTheme): CustomTheme | null => {
      const key = themeKey(t);
      const existing = customThemes.find((x) => themeKey(x) === key);
      const theme = existing ?? t;
      if (!existing && !commitThemes([...customThemes, t])) return null;
      applyTheme(theme);
      return theme;
    },
    [customThemes, commitThemes, applyTheme]
  );

  return {
    customThemes,
    setCustomThemes,
    captureTheme,
    saveNamedTheme,
    applyTheme,
    applyNamedTheme,
    adoptTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
  };
}
