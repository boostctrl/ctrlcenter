"use client";

// The visitor's look (#290 split from PrefsProvider): appearance mode, the
// per-mode design/scene/font, custom colors and accents, saved themes, and
// the DOM application of all of it. PrefsProvider exposes the result as its
// own context (useLookPrefs), so a color change doesn't re-render consumers
// that only read the location or favorites.
//
// Every paint here reads the latest state (./lookState), never the render's:
// a setter writes its slice, then calls paintLook/paintChrome, so a handler
// that calls several setters in one click paints each from what the earlier
// ones just set (#429). The site default a paint falls back to is resolved
// from that state too (the day/night schedule switch), through pure helpers
// of the theme rather than this render's closures (#395).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadActiveTheme,
  saveActiveTheme,
  loadThemes,
  loadAccentOverride,
  saveAccentOverride,
  loadDesign,
  saveDesign,
  loadScene,
  saveScene,
  loadFont,
  saveFont,
  loadTune,
  saveTune,
  loadSceneFx,
  saveSceneFx,
  loadReduceMotion,
  saveReduceMotion,
  loadHeadingFont,
  saveHeadingFont,
  loadDensity,
  saveDensity,
  loadStatusColors,
  saveStatusColors,
  loadWallpaper,
  saveWallpaper,
  loadPackChoice,
  savePackChoice,
  loadFollowSchedule,
  saveFollowSchedule,
  NO_ACCENT_OVERRIDES,
  type HeadingChoice,
  type WallpaperChoice,
  type TuneChoice,
  type SceneFxChoice,
  type StatusChoice,
  type CustomTheme,
  type AccentColors,
  type AccentOverrides,
  type ModePair,
} from "@/lib/prefs";
import { packByRef, packDesign, packKey, packScene } from "@/lib/theme";
import type {
  ColorSet,
  Density,
  DesignId,
  ModeColors,
  MotionLevel,
  SceneFx,
  SceneId,
  SemanticColors,
  ThemePack,
  Tune,
  VisitorTheming,
  Wallpaper,
} from "@/lib/theme";
import type { FontId } from "@/lib/fonts";
import {
  applyAll as paintAll,
  applyDesign,
  applyFont,
  applyHeadingFont,
  applyScene,
  isLightColor,
  overrideFor,
  resolveAccent,
  resolveDark,
  variantFor,
  type Accent,
  type Mode,
  type Theme,
} from "./themeApply";
import { useSavedThemes } from "./useSavedThemes";
import { forMode, initialLookState, NO_CHOICE, useLookState, type LookState } from "./lookState";

export const THEME_KEY = "ctrlcenter:theme";

// The admin-configured site default theme. Visitor choices override each part.
// The optional custom default colors are a cohesive light+dark pair (dark =
// `background`/`foreground`, light = `backgroundLight`/`foregroundLight`); when
// set they seed the surface for un-customized visitors in each mode. The accent
// pair is shared across both modes.
export type DefaultTheme = {
  mode: Theme;
  // The dark-mode design/scene/font; the optional `*Light` fields let the admin
  // set a wholly different look for light mode (falling back to the dark parts).
  design: DesignId;
  scene: SceneId;
  font: FontId;
  designLight?: DesignId;
  sceneLight?: SceneId;
  fontLight?: FontId;
  accentFrom: string;
  accentTo: string;
  accentFromLight?: string;
  accentToLight?: string;
  background?: string;
  foreground?: string;
  backgroundLight?: string;
  foregroundLight?: string;
  // The site default's fine-tune over the design, per mode (#326).
  tune?: Tune;
  tuneLight?: Tune;
  // The site default's scene effects, per mode (#327).
  sceneIntensity?: number;
  sceneMotion?: MotionLevel;
  sceneIntensityLight?: number;
  sceneMotionLight?: MotionLevel;
  // The site default's heading font and density, per mode (#330).
  headingFont?: FontId;
  headingFontLight?: FontId;
  density?: Density;
  densityLight?: Density;
  // The site default's semantic colors, per mode (#331).
  status?: SemanticColors;
  statusLight?: SemanticColors;
  // The site default's wallpaper, per mode (#333).
  wallpaper?: Wallpaper;
  wallpaperLight?: Wallpaper;
};

export type LookValue = {
  theme: Theme;
  // The appearance mode actually displayed now ("dark"/"light"). A live theme-
  // builder preview can make this differ from `theme` (the saved choice) without
  // persisting anything.
  resolvedMode: Mode;
  // Resolved for the current display mode (what's on <html> right now).
  design: DesignId;
  scene: SceneId;
  font: FontId;
  // Resolved design/scene/font for a specific mode — for the theme builder, whose
  // Editing toggle designs the non-displayed mode independently.
  designFor: (mode: Mode) => DesignId;
  sceneFor: (mode: Mode) => SceneId;
  fontFor: (mode: Mode) => FontId;
  // The site default font and heading font for a mode: what a theme without
  // its own falls back to (#373).
  defaultFontFor: (mode: Mode) => FontId;
  defaultHeadingFontFor: (mode: Mode) => FontId | null;
  // The effective fine-tune for a mode (visitor's, else the admin default),
  // or null when the design is untouched (#326).
  tuneFor: (mode: Mode) => Tune | null;
  // The effective scene effects for a mode (visitor's, else the admin
  // default), or null when the scene is as designed (#327).
  sceneFxFor: (mode: Mode) => SceneFx | null;
  // The effective colors for a mode — the active look's variant (else the
  // admin default, else the stock colors) with that mode's accent override
  // applied — so the builder can tell which theme or palette is active (#328).
  colorsFor: (mode: Mode) => ColorSet;
  // The effective heading font for a mode (null = the body font) and the
  // density (#330).
  headingFontFor: (mode: Mode) => FontId | null;
  densityFor: (mode: Mode) => Density;
  // The effective semantic colors for a mode, or null for the stylesheet's
  // defaults (#331).
  statusFor: (mode: Mode) => SemanticColors | null;
  // The effective wallpaper for a mode, or null for none (#333).
  wallpaperFor: (mode: Mode) => Wallpaper | null;
  // What this visitor may change (#335): "all" for an admin.
  visitorTheming: VisitorTheming;
  // The visitor's Reduce motion switch, and the motion level the scenes run
  // at now: "off" when the switch is on, else the displayed mode's effects.
  reduceMotion: boolean;
  motion: MotionLevel;
  // True once the stored look (saved themes included) has been read on
  // mount, so a consumer that writes the saved list from a link (#329) can
  // wait for it rather than clobber it with the empty SSR state.
  hydrated: boolean;
  // Whether the effective background reads as light (for theme-aware icons).
  surfaceIsLight: boolean;
  customThemes: CustomTheme[];
  // The active look's full light+dark pair, and the color set resolved for the
  // current mode (what the builder's pickers show).
  activeLook: ModeColors | null;
  activeColors: ColorSet | null;
  // Per-mode standalone accent overrides, and the accent resolved for the
  // current display mode.
  accentOverride: AccentOverrides;
  activeAccent: AccentColors;
  setTheme: (theme: Theme) => void;
  // Preview a mode's appearance without persisting it (theme builder). Passing
  // null drops the preview and returns to the saved `theme`.
  setPreviewMode: (mode: Mode | null) => void;
  setDesign: (design: DesignId, mode: Mode) => void;
  setScene: (scene: SceneId, mode: Mode) => void;
  setFont: (font: FontId, mode: Mode) => void;
  // A mode's fine-tune: a tune, "none" (the design as drawn, even over an
  // admin default tune, #395), or null (not chosen: the admin default). The
  // scene effects and the status colors take the same three (#395).
  setTune: (tune: TuneChoice | null, mode: Mode) => void;
  setSceneFx: (fx: SceneFxChoice | null, mode: Mode) => void;
  setReduceMotion: (reduce: boolean) => void;
  // A heading font for a mode: a face, "body" (follow the body font, even
  // over an admin default heading face), or null (not chosen).
  setHeadingFont: (font: HeadingChoice | null, mode: Mode) => void;
  setDensity: (density: Density | null, mode: Mode) => void;
  setStatusColors: (status: StatusChoice | null, mode: Mode) => void;
  // A wallpaper for a mode: an image, "none" (no wallpaper, even over an
  // admin default), or null (not chosen).
  setWallpaper: (wallpaper: WallpaperChoice | null, mode: Mode) => void;
  applyPack: (pack: ThemePack, mode: Mode) => void;
  applyThemeColors: (colors: ModeColors, mode?: Mode) => void;
  setBaseColors: (
    background: string,
    foreground: string,
    targetDark?: boolean
  ) => void;
  // Set or clear one mode's standalone accent (light and dark are independent).
  setAccentOverride: (accent: AccentColors | null, mode: Mode) => void;
  // Returns false when the theme couldn't be persisted (storage unavailable).
  // With `overwriteId`, replaces that saved theme in place (same id and list
  // position) instead of appending a second copy.
  saveNamedTheme: (name: string, overwriteId?: string) => boolean;
  applyNamedTheme: (id: string) => void;
  // The current look as a theme object under `name`, without saving it — for
  // "Copy as code" (#329).
  captureTheme: (name: string, id: string) => CustomTheme;
  // Save (unless already saved) and apply a theme from a code or link; null
  // when it couldn't be stored.
  adoptTheme: (theme: CustomTheme) => CustomTheme | null;
  // Rename a saved theme in place. Returns false for an empty name, an unknown
  // id, or a failed write.
  renameNamedTheme: (id: string, name: string) => boolean;
  deleteNamedTheme: (id: string) => void;
  // Append already-sanitized imported themes, skipping any that duplicate an
  // existing or just-imported one. Returns the number added (0 when all were
  // duplicates), or null when the write couldn't be persisted.
  importNamedThemes: (themes: CustomTheme[]) => number | null;
  clearCustomTheme: () => void;
  resetTheme: () => void;
};

// The admin default parts for a mode, from a site default theme: light
// falls back to the dark part when the admin hasn't set a separate light
// value. Pure functions of the theme, so a paint can resolve them for
// whichever site default the latest state picks (#395).
function defDesign(dt: DefaultTheme, dark: boolean): DesignId {
  return dark ? dt.design : dt.designLight ?? dt.design;
}
function defScene(dt: DefaultTheme, dark: boolean): SceneId {
  return dark ? dt.scene : dt.sceneLight ?? dt.scene;
}
function defFont(dt: DefaultTheme, dark: boolean): FontId {
  return dark ? dt.font : dt.fontLight ?? dt.font;
}
function defTune(dt: DefaultTheme, dark: boolean): Tune | null {
  return (dark ? dt.tune : dt.tuneLight ?? dt.tune) ?? null;
}
// A heading of null means the body font.
function defHeading(dt: DefaultTheme, dark: boolean): FontId | null {
  return (dark ? dt.headingFont : dt.headingFontLight ?? dt.headingFont) ?? null;
}
function defDensity(dt: DefaultTheme, dark: boolean): Density {
  return (dark ? dt.density : dt.densityLight ?? dt.density) ?? "comfortable";
}
function defStatus(dt: DefaultTheme, dark: boolean): SemanticColors | null {
  return (dark ? dt.status : dt.statusLight ?? dt.status) ?? null;
}
function defWallpaper(dt: DefaultTheme, dark: boolean): Wallpaper | null {
  return (dark ? dt.wallpaper : dt.wallpaperLight ?? dt.wallpaper) ?? null;
}
// The admin default scene effects for a mode: light falls back to dark per
// field; null when neither field is set.
function defSceneFx(dt: DefaultTheme, dark: boolean): SceneFx | null {
  const intensity = dark ? dt.sceneIntensity : dt.sceneIntensityLight ?? dt.sceneIntensity;
  const motion = dark ? dt.sceneMotion : dt.sceneMotionLight ?? dt.sceneMotion;
  if (intensity === undefined && motion === undefined) return null;
  return { intensity: intensity ?? 100, motion: motion ?? "normal" };
}
// The admin default accent, shared across both modes.
function defAccent(dt: DefaultTheme): Accent {
  return { from: dt.accentFrom, to: dt.accentTo };
}
// The admin custom default colors as a light+dark pair (a baseline look for
// a visitor who hasn't customized colors), or null without them. Light
// falls back to the dark surface colors — and to the shared accent, unless
// the default theme carries its own light accents (a promoted theme does,
// #142).
function adminLookOf(dt: DefaultTheme): ModeColors | null {
  if (!dt.background || !dt.foreground) return null;
  return {
    dark: { background: dt.background, foreground: dt.foreground, accentFrom: dt.accentFrom, accentTo: dt.accentTo },
    light: {
      background: dt.backgroundLight ?? dt.background,
      foreground: dt.foregroundLight ?? dt.foreground,
      accentFrom: dt.accentFromLight ?? dt.accentFrom,
      accentTo: dt.accentToLight ?? dt.accentTo,
    },
  };
}

// The effective part for a mode, from the visitor's per-mode pair over the
// site default `dt`: the visitor's choice; their explicit "none" ("body" for
// the heading) — the design as drawn, the scene as designed, the standard
// status colors, no wallpaper, the body font — which clears an admin default
// too (#395); else the admin default. One rule, shared by the render's
// resolvers and the paints, so "nothing chosen" never stands in for "none".
function tuneOf(pair: ModePair<TuneChoice | null>, dt: DefaultTheme, dark: boolean): Tune | null {
  const v = forMode(pair, dark);
  if (v === "none") return null;
  return v ?? defTune(dt, dark);
}
function sceneFxOf(pair: ModePair<SceneFxChoice | null>, dt: DefaultTheme, dark: boolean): SceneFx | null {
  const v = forMode(pair, dark);
  if (v === "none") return null;
  return v ?? defSceneFx(dt, dark);
}
function statusOf(pair: ModePair<StatusChoice | null>, dt: DefaultTheme, dark: boolean): SemanticColors | null {
  const v = forMode(pair, dark);
  if (v === "none") return null;
  return v ?? defStatus(dt, dark);
}
function headingOf(pair: ModePair<HeadingChoice | null>, dt: DefaultTheme, dark: boolean): FontId | null {
  const v = forMode(pair, dark);
  if (v === "body") return null;
  return v ?? defHeading(dt, dark);
}
function wallpaperOf(pair: ModePair<WallpaperChoice | null>, dt: DefaultTheme, dark: boolean): Wallpaper | null {
  const v = forMode(pair, dark);
  if (v === "none") return null;
  return v ?? defWallpaper(dt, dark);
}

// A seeded color set for a mode when there's no active custom look yet —
// the admin default colors, else the CSS :root / .theme-light values, with
// the accent resolved from `override` — so editing one mode never leaves the
// other mode's colors null.
function seedFor(override: AccentOverrides, dt: DefaultTheme, dark: boolean): ColorSet {
  const adminLook = adminLookOf(dt);
  const a = resolveAccent(overrideFor(override, dark), variantFor(adminLook, dark), defAccent(dt));
  const ad = adminLook ? (dark ? adminLook.dark : adminLook.light) : null;
  return {
    background: ad?.background ?? (dark ? "#06070d" : "#eceef3"),
    foreground: ad?.foreground ?? (dark ? "#f4f4f6" : "#181b24"),
    accentFrom: a.from,
    accentTo: a.to,
  };
}

// Whether the visitor chose an appearance mode of their own, which a site
// default's mode (a phase's, a pinned board's) then doesn't replace. Under
// the "none" policy nothing stored is read.
function hasOwnMode(policy: VisitorTheming): boolean {
  if (policy === "none") return false;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" || stored === "system";
  } catch {
    return false;
  }
}

// All look state for `defaultTheme` — the site's theme for this page: a
// pinned board's (#337), else the current phase's under a day/night
// schedule (#336), else the site's own. `resetLook` drops every
// customization, mode included (the theme half of the global reset).
export function useLook(
  defaultTheme: DefaultTheme,
  // What this visitor may change (#335), the site's themes a "packs" choice
  // resolves against, and — under a schedule, off any pinned board — the
  // site's usual theme, which stands in for `defaultTheme` for a visitor
  // who turned the schedule off (#395). An admin gets "all" whatever the
  // site says.
  gate: { policy: VisitorTheming; packs: ThemePack[]; unscheduled?: DefaultTheme | null } = {
    policy: "all",
    packs: [],
  }
): {
  look: LookValue;
  resetLook: () => void;
  // The visitor's day/night schedule switch (#336): follow the site's
  // schedule (the default), or keep its usual theme under their own choices.
  followSchedule: boolean;
  setFollowSchedule: (follow: boolean) => void;
} {
  const policy = gate.policy;
  const unscheduled = gate.unscheduled ?? null;
  // The look state, with the live mirror the paints read (`latest`) and the
  // one way to write it (`update`). The per-mode parts are visitor overrides:
  // a null per mode means "use the admin default". `previewMode` is a
  // non-persisted appearance-mode preview for the theme builder: lets the
  // visitor see a mode while editing it without changing their saved choice.
  const { state, latest, update } = useLookState(initialLookState(defaultTheme.mode));
  const {
    theme,
    previewMode,
    designs,
    scenes,
    fonts,
    tunes,
    sceneFxs,
    reduceMotion,
    headings,
    densities,
    statuses,
    wallpapers,
    activeLook,
    accentOverride,
    followSchedule,
  } = state;
  // The site default in force for a state: the page's, or the site's usual
  // theme for a visitor who turned the schedule off. The paints take it from
  // the latest state, so the mount paint already honours the stored switch
  // and the phase's theme never shows for a paint first (#395).
  const siteOf = useCallback(
    (s: LookState): DefaultTheme => (s.followSchedule || !unscheduled ? defaultTheme : unscheduled),
    [defaultTheme, unscheduled]
  );
  const site = siteOf(state);
  const defaultAccent = useMemo(() => defAccent(site), [site]);
  const adminLook = useMemo(() => adminLookOf(site), [site]);
  const [hydrated, setHydrated] = useState(false);
  // Tracks the OS color scheme so "system" mode resolves its surface lightness.
  const [systemDark, setSystemDark] = useState(false);

  // The mode actually shown on screen: a live builder preview overrides the
  // saved app mode (without persisting). Everything that drives the *display* —
  // the DOM classes/vars and the resolved design/scene/font — keys off this,
  // while persistence and the Preferences toggle still use the saved `theme`.
  const displayTheme: Theme = previewMode ?? theme;
  // The same, from the latest state — for a setter's "is this mode on
  // screen?" check, which must see a setTheme made a moment earlier.
  const liveTheme = useCallback((): Theme => latest().previewMode ?? latest().theme, [latest]);
  const onScreen = useCallback((mode: Mode) => (mode === "dark") === resolveDark(liveTheme()), [liveTheme]);

  // The effective parts for a mode, for this render: the visitor's per-mode
  // choice over the site default (see the *Of helpers above).
  const resolveDesign = useCallback(
    (dark: boolean): DesignId => forMode(designs, dark) ?? defDesign(site, dark),
    [designs, site]
  );
  const resolveScene = useCallback(
    (dark: boolean): SceneId => forMode(scenes, dark) ?? defScene(site, dark),
    [scenes, site]
  );
  const resolveFont = useCallback(
    (dark: boolean): FontId => forMode(fonts, dark) ?? defFont(site, dark),
    [fonts, site]
  );
  const resolveTune = useCallback((dark: boolean): Tune | null => tuneOf(tunes, site, dark), [tunes, site]);
  const resolveSceneFx = useCallback(
    (dark: boolean): SceneFx | null => sceneFxOf(sceneFxs, site, dark),
    [sceneFxs, site]
  );
  const resolveHeading = useCallback(
    (dark: boolean): FontId | null => headingOf(headings, site, dark),
    [headings, site]
  );
  const resolveDensity = useCallback(
    (dark: boolean): Density => forMode(densities, dark) ?? defDensity(site, dark),
    [densities, site]
  );
  const resolveStatus = useCallback(
    (dark: boolean): SemanticColors | null => statusOf(statuses, site, dark),
    [statuses, site]
  );
  const resolveWallpaper = useCallback(
    (dark: boolean): Wallpaper | null => wallpaperOf(wallpapers, site, dark),
    [wallpapers, site]
  );

  // The two paints, and the only two: the colors, tune, effects, density,
  // status colors and wallpaper (paintLook), and the design/scene/font/
  // heading classes (paintChrome), each resolved for the mode on screen from
  // the LATEST state — what the setters have written so far in this handler
  // — never from this render's, so no setter has to hand a paint the part it
  // just set (#363, #373, #394, #429). A setter writes, then paints. The
  // site default is resolved from that state too (the schedule switch).
  const paintLook = useCallback(() => {
    const s = latest();
    const dt = siteOf(s);
    const theme = s.previewMode ?? s.theme;
    const dark = resolveDark(theme);
    paintAll({
      theme,
      // A per-visitor custom look wins, otherwise the admin custom default
      // colors, otherwise null = the built-in light/dark CSS defaults. The
      // admin default carries BOTH variants, so the mode just selects one.
      look: s.activeLook ?? adminLookOf(dt),
      accentOverride: s.accentOverride,
      defaultAccent: defAccent(dt),
      tune: tuneOf(s.tunes, dt, dark),
      sceneFx: sceneFxOf(s.sceneFxs, dt, dark),
      reduceMotion: s.reduceMotion,
      density: forMode(s.densities, dark) ?? defDensity(dt, dark),
      status: statusOf(s.statuses, dt, dark),
      wallpaper: wallpaperOf(s.wallpapers, dt, dark),
    });
  }, [latest, siteOf]);
  const paintChrome = useCallback(() => {
    const s = latest();
    const dt = siteOf(s);
    const dark = resolveDark(s.previewMode ?? s.theme);
    applyDesign(forMode(s.designs, dark) ?? defDesign(dt, dark));
    applyScene(forMode(s.scenes, dark) ?? defScene(dt, dark));
    applyFont(forMode(s.fonts, dark) ?? defFont(dt, dark));
    applyHeadingFont(headingOf(s.headings, dt, dark));
  }, [latest, siteOf]);

  // The seeded color set for a mode (seedFor above): `seedColorSet` from
  // this render's accents, for the builder's readers; `seedLook` both modes
  // from the latest — the base a one-mode color edit builds on when no
  // custom look exists yet.
  const seedColorSet = useCallback(
    (dark: boolean): ColorSet => seedFor(accentOverride, site, dark),
    [accentOverride, site]
  );
  const seedLook = useCallback((): ModeColors => {
    const s = latest();
    const dt = siteOf(s);
    return { dark: seedFor(s.accentOverride, dt, true), light: seedFor(s.accentOverride, dt, false) };
  }, [latest, siteOf]);

  const setTheme = useCallback(
    (next: Theme) => {
      // Committing a real mode ends any live preview.
      update({ previewMode: null, theme: next });
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Private mode / quota — theme just won't persist.
      }
      // Picking a mode keeps the effective look (visitor custom, else admin
      // default); it just re-resolves to that look's matching light/dark variant
      // — and to that mode's own design/scene/font, which are independent.
      paintLook();
      paintChrome();
    },
    [update, paintLook, paintChrome]
  );

  // Preview a mode's appearance live (theme builder) without persisting it, or
  // pass null to drop the preview and return to the saved mode. Only the display
  // changes — `theme` and localStorage are untouched, so leaving the page (which
  // clears this) reverts to the saved choice.
  const setPreviewMode = useCallback(
    (mode: Mode | null) => {
      update({ previewMode: mode });
      paintLook();
      paintChrome();
    },
    [update, paintLook, paintChrome]
  );

  // Set one mode's design/scene/font. Persists the per-mode pair and applies the
  // class immediately only when that mode is the one currently displayed.
  const setDesign = useCallback(
    (next: DesignId, mode: Mode) => {
      const { designs } = update((s) => ({ designs: { ...s.designs, [mode]: next } }));
      saveDesign(designs);
      if (onScreen(mode)) paintChrome();
    },
    [update, onScreen, paintChrome]
  );

  const setScene = useCallback(
    (next: SceneId, mode: Mode) => {
      const { scenes } = update((s) => ({ scenes: { ...s.scenes, [mode]: next } }));
      saveScene(scenes);
      if (onScreen(mode)) paintChrome();
    },
    [update, onScreen, paintChrome]
  );

  // Set one mode's font, or null to fall back to the site default (a theme
  // without a font of its own); the class swaps only when that mode is on
  // screen.
  const setFont = useCallback(
    (next: FontId | null, mode: Mode) => {
      const { fonts } = update((s) => ({ fonts: { ...s.fonts, [mode]: next } }));
      saveFont(fonts);
      if (onScreen(mode)) paintChrome();
    },
    [update, onScreen, paintChrome]
  );

  // Apply (and persist) custom colors. With a `mode`, only that mode's colorset
  // is filled (from `colors[mode]`), leaving the other mode untouched — this is
  // how a preset fills just the mode being edited. Without a `mode`, both modes
  // are replaced (restoring a complete saved theme). The colorset carries its own
  // accent, so any standalone accent override is dropped in favor of it.
  const applyThemeColors = useCallback(
    (colors: ModeColors, mode?: Mode) => {
      const look: ModeColors = mode
        ? { ...(latest().activeLook ?? seedLook()), [mode]: colors[mode] }
        : colors;
      update({ activeLook: look, accentOverride: NO_ACCENT_OVERRIDES });
      saveActiveTheme(look);
      saveAccentOverride(null);
      paintLook();
    },
    [latest, seedLook, update, paintLook]
  );

  // Set one mode's fine-tune over its design ("none" = the design as drawn,
  // null = the admin default). Persists the per-mode pair and repaints only
  // when that mode is the one on screen.
  const setTune = useCallback(
    (next: TuneChoice | null, mode: Mode) => {
      const { tunes } = update((s) => ({ tunes: { ...s.tunes, [mode]: next } }));
      saveTune(tunes);
      if (onScreen(mode)) paintLook();
    },
    [update, onScreen, paintLook]
  );

  // Set one mode's heading font (a face, "body", or null to fall back to the
  // admin default); the class swaps only when that mode is on screen.
  const setHeadingFont = useCallback(
    (next: HeadingChoice | null, mode: Mode) => {
      const { headings } = update((s) => ({ headings: { ...s.headings, [mode]: next } }));
      saveHeadingFont(headings);
      if (onScreen(mode)) paintChrome();
    },
    [update, onScreen, paintChrome]
  );

  // Set (or clear) one mode's density, painting its factor when on screen.
  const setDensity = useCallback(
    (next: Density | null, mode: Mode) => {
      const { densities } = update((s) => ({ densities: { ...s.densities, [mode]: next } }));
      saveDensity(densities);
      if (onScreen(mode)) paintLook();
    },
    [update, onScreen, paintLook]
  );

  // Set one mode's semantic colors, like setTune ("none" = the standard
  // colors).
  const setStatusColors = useCallback(
    (next: StatusChoice | null, mode: Mode) => {
      const { statuses } = update((s) => ({ statuses: { ...s.statuses, [mode]: next } }));
      saveStatusColors(statuses);
      if (onScreen(mode)) paintLook();
    },
    [update, onScreen, paintLook]
  );

  // Set (or clear) one mode's wallpaper, like setTune; "none" hides an
  // admin default wallpaper too.
  const setWallpaper = useCallback(
    (next: WallpaperChoice | null, mode: Mode) => {
      const { wallpapers } = update((s) => ({ wallpapers: { ...s.wallpapers, [mode]: next } }));
      saveWallpaper(wallpapers);
      if (onScreen(mode)) paintLook();
    },
    [update, onScreen, paintLook]
  );

  // Set one mode's scene effects, like setTune ("none" = as designed).
  const setSceneFx = useCallback(
    (next: SceneFxChoice | null, mode: Mode) => {
      const { sceneFxs } = update((s) => ({ sceneFxs: { ...s.sceneFxs, [mode]: next } }));
      saveSceneFx(sceneFxs);
      if (onScreen(mode)) paintLook();
    },
    [update, onScreen, paintLook]
  );

  // The Reduce motion switch: a preference, not a theme part, so it survives
  // "Reset theme" (the global reset clears it).
  const setReduceMotion = useCallback(
    (reduce: boolean) => {
      update({ reduceMotion: reduce });
      saveReduceMotion(reduce);
      paintLook();
    },
    [update, paintLook]
  );

  // Apply a curated pack to one mode: its design + scene + that mode's
  // colorset, and the parts it carries. A pack is a whole look, so what it
  // doesn't carry is cleared outright, not left to the site default (#395):
  // without a tune the design is as drawn, the scene runs as designed,
  // without status colors the stylesheet's apply, without a wallpaper there
  // is none. The fonts are the exception: a pack without them takes the
  // site default's (#373). The no-flash script resolves a chosen pack the
  // same way, so a reload paints what this click painted.
  const applyPack = useCallback(
    (pack: ThemePack, mode: Mode) => {
      const dark = mode === "dark";
      const status = (dark ? pack.status : pack.statusLight ?? pack.status) ?? "none";
      const wallpaper = (dark ? pack.wallpaper : pack.wallpaperLight ?? pack.wallpaper) ?? "none";
      setDesign(packDesign(pack, dark), mode);
      setScene(packScene(pack, dark), mode);
      setTune(pack.tune ?? "none", mode);
      setSceneFx("none", mode);
      setFont(pack.font ?? null, mode);
      setHeadingFont(pack.headingFont ?? null, mode);
      setStatusColors(status, mode);
      setWallpaper(wallpaper, mode);
      // The colors paint last, with every part above: each paint reads the
      // latest state, so the setters' values are what it paints (#363).
      applyThemeColors({ dark: pack.dark, light: pack.light }, mode);
      // Under "themes only" (#335) the choice is the pack's gallery key
      // (stable across a rename, #395): the parts above are what this visit
      // paints, but the next page load resolves the key against the site's
      // themes and reads nothing else.
      if (policy === "packs") savePackChoice({ ...loadPackChoice(), [mode]: packKey(pack) });
    },
    [
      policy,
      setDesign,
      setScene,
      setTune,
      setSceneFx,
      setFont,
      setHeadingFont,
      setStatusColors,
      setWallpaper,
      applyThemeColors,
    ]
  );

  // Update only the background/foreground for the CURRENT mode's variant,
  // leaving the accent and the other mode's variant as-is (live edit from the
  // theme builder's base-color pickers). With no active look yet, seed both
  // modes from the edit so the new look still has both.
  const setBaseColors = useCallback(
    (background: string, foreground: string, targetDark?: boolean) => {
      // Which mode's colorset to edit. Defaults to the displayed mode (the old
      // behavior); the theme builder passes an explicit target so it can design
      // the non-active mode without changing what the app shows.
      const s = latest();
      const dark = targetDark ?? resolveDark(liveTheme());
      const accent = resolveAccent(
        overrideFor(s.accentOverride, dark),
        variantFor(s.activeLook, dark),
        defAccent(siteOf(s))
      );
      const cs: ColorSet = {
        background,
        foreground,
        accentFrom: accent.from,
        accentTo: accent.to,
      };
      // With no custom look yet, seed each mode with ITS OWN defaults (admin
      // default colors, else the CSS :root / .theme-light values) so editing one
      // mode never overwrites the other.
      const base = s.activeLook ?? seedLook();
      const next: ModeColors = dark ? { ...base, dark: cs } : { ...base, light: cs };
      update({ activeLook: next });
      saveActiveTheme(next);
      // Display follows the on-screen mode (the saved `theme`, or a live builder
      // preview), so editing the previewed mode shows immediately.
      paintLook();
    },
    [latest, liveTheme, siteOf, seedLook, update, paintLook]
  );

  // Set or clear one mode's accent on its own, leaving the background/foreground
  // (and the other mode's accent) as-is.
  const setAccentOverride = useCallback(
    (next: AccentColors | null, mode: Mode) => {
      const { accentOverride } = update((s) => ({
        accentOverride: { ...s.accentOverride, [mode]: next },
      }));
      saveAccentOverride(accentOverride);
      paintLook();
    },
    [update, paintLook]
  );

  const {
    customThemes,
    setCustomThemes,
    captureTheme,
    saveNamedTheme,
    applyNamedTheme,
    adoptTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
  } = useSavedThemes({
    activeLook,
    seedColorSet,
    accentOverride,
    defaultAccent,
    resolveDesign,
    resolveScene,
    resolveFont,
    resolveTune,
    resolveSceneFx,
    applyThemeColors,
    update,
    paintChrome,
    resolveHeading,
    resolveDensity,
    resolveStatus,
    resolveWallpaper,
  });

  const clearCustomTheme = useCallback(() => {
    update({ activeLook: null, accentOverride: NO_ACCENT_OVERRIDES });
    saveActiveTheme(null);
    saveAccentOverride(null);
    paintLook();
  }, [update, paintLook]);

  // Every part back to the admin default — what both resets share. The
  // mode and the Reduce motion switch are the global reset's own.
  const clearParts = useCallback(() => {
    update({
      activeLook: null,
      accentOverride: NO_ACCENT_OVERRIDES,
      designs: NO_CHOICE,
      scenes: NO_CHOICE,
      fonts: NO_CHOICE,
      tunes: NO_CHOICE,
      sceneFxs: NO_CHOICE,
      headings: NO_CHOICE,
      densities: NO_CHOICE,
      statuses: NO_CHOICE,
      wallpapers: NO_CHOICE,
    });
    saveActiveTheme(null);
    saveAccentOverride(null);
    saveDesign(null);
    saveScene(null);
    saveFont(null);
    saveTune(null);
    saveSceneFx(null);
    saveHeadingFont(null);
    saveDensity(null);
    saveStatusColors(null);
    saveWallpaper(null);
    savePackChoice(null);
  }, [update]);

  // Reset just the theme (colors, accent, design, scene, font — both modes) back
  // to the admin defaults, leaving mode/location/greeting alone — the theme
  // builder's own reset, distinct from the global `reset`.
  const resetTheme = useCallback(() => {
    clearParts();
    paintLook();
    paintChrome();
  }, [clearParts, paintLook, paintChrome]);

  const resetLook = useCallback(() => {
    // Drop all theme customizations so the visitor falls back to the admin
    // default theme (mode, design, colors, accent). A builder preview ends
    // too, as it does when a mode is picked: the page shows the site's mode.
    try {
      window.localStorage.removeItem(THEME_KEY);
    } catch {
      // ignore
    }
    // The day/night schedule switch (#336) is a setting too, so it goes
    // back to following the site (#395).
    clearParts();
    update({ theme: defaultTheme.mode, previewMode: null, reduceMotion: false, followSchedule: true });
    saveReduceMotion(false);
    saveFollowSchedule(true);
    paintLook();
    paintChrome();
  }, [defaultTheme.mode, clearParts, update, paintLook, paintChrome]);

  // The visitor's day/night schedule switch (#336): off, the site's usual
  // theme stands in for the phase's — with its mode, unless the visitor
  // chose one — and the page repaints at once, as it does at a phase switch.
  const setFollowSchedule = useCallback(
    (follow: boolean) => {
      update({ followSchedule: follow });
      saveFollowSchedule(follow);
      if (!hasOwnMode(policy) && !latest().previewMode) update({ theme: siteOf(latest()).mode });
      paintLook();
      paintChrome();
    },
    [update, policy, latest, siteOf, paintLook, paintChrome]
  );

  // What an OS light/dark flip repaints: "system" re-resolved — the look AND
  // the design/scene/font are mode-aware. The visitor's parts come from the
  // latest state; the site default (a pinned board's theme (#337), a schedule
  // phase (#336)) is a prop, so the mount effect's listener reaches the
  // current render's paint through a ref rather than its own closure (#394).
  // A builder preview (#290) shows one mode whatever the OS says, so it holds.
  const paintSystem = useCallback(() => {
    if (liveTheme() !== "system") return;
    paintLook();
    paintChrome();
  }, [liveTheme, paintLook, paintChrome]);
  const paintSystemRef = useRef(paintSystem);
  useEffect(() => {
    paintSystemRef.current = paintSystem;
  });

  // Load the stored theme + custom themes on mount and keep "system" in sync
  // with OS changes. Anything the visitor hasn't set falls back to the admin
  // default theme.
  useEffect(() => {
    // What this visitor may change (#335): under "packs" the stored look is
    // the chosen pack per mode, resolved against the site's themes, and the
    // mode; under "none" nothing but the Reduce motion switch. The rest of
    // what's stored is left unread, so a browser customized before the
    // policy changed falls back at once — as the no-flash script did.
    const gated = policy !== "all";
    // The visitor's day/night schedule switch (#336), read under the same
    // policy as the no-flash script (never under "none"), and before the
    // paint below — so a visitor who turned the schedule off gets the
    // site's usual theme from the first paint on, not the phase's for one
    // paint and the usual one on the next (#395).
    const follow = policy === "none" ? true : loadFollowSchedule();
    const dt = follow || !unscheduled ? defaultTheme : unscheduled;
    let stored: Theme = dt.mode;
    if (policy !== "none") {
      try {
        const raw = window.localStorage.getItem(THEME_KEY);
        if (raw === "light" || raw === "dark" || raw === "system") {
          stored = raw;
        }
      } catch {
        // ignore
      }
    }
    // A chosen pack by its gallery key, or by name for a choice saved before
    // keys were stored (#395).
    const choice = policy === "packs" ? loadPackChoice() : { dark: null, light: null };
    const packOf = (dark: boolean): ThemePack | null => packByRef(gate.packs, dark ? choice.dark : choice.light) ?? null;
    const dp = packOf(true);
    const lp = packOf(false);
    const fromPacks = <T,>(f: (p: ThemePack, dark: boolean) => T | null): ModePair<T | null> => ({
      dark: dp ? f(dp, true) : null,
      light: lp ? f(lp, false) : null,
    });
    const active = gated
      ? dp || lp
        ? {
            dark: dp ? dp.dark : seedFor(NO_ACCENT_OVERRIDES, dt, true),
            light: lp ? lp.light : seedFor(NO_ACCENT_OVERRIDES, dt, false),
          }
        : null
      : loadActiveTheme();
    const overrideAccent = gated ? NO_ACCENT_OVERRIDES : loadAccentOverride();
    const storedDesigns = gated ? fromPacks(packDesign) : loadDesign();
    const storedScenes = gated ? fromPacks(packScene) : loadScene();
    const storedFonts = gated ? fromPacks((p) => p.font ?? null) : loadFont();
    // A chosen pack lands exactly as applyPack lands it (#395): the parts
    // it doesn't carry cleared, the fonts and the density the site's.
    const storedTunes: ModePair<TuneChoice | null> = gated ? fromPacks((p) => p.tune ?? "none") : loadTune();
    const storedFx: ModePair<SceneFxChoice | null> = gated ? fromPacks(() => "none") : loadSceneFx();
    const storedReduce = loadReduceMotion();
    const storedHeadings: ModePair<HeadingChoice | null> = gated ? fromPacks((p) => p.headingFont ?? null) : loadHeadingFont();
    const storedDensities: ModePair<Density | null> = gated ? { dark: null, light: null } : loadDensity();
    const storedStatuses: ModePair<StatusChoice | null> = gated
      ? fromPacks((p, dark) => (dark ? p.status : p.statusLight ?? p.status) ?? "none")
      : loadStatusColors();
    const storedWallpapers: ModePair<WallpaperChoice | null> = gated
      ? fromPacks((p, dark) => (dark ? p.wallpaper : p.wallpaperLight ?? p.wallpaper) ?? "none")
      : loadWallpaper();
    update({
      theme: stored,
      followSchedule: follow,
      designs: storedDesigns,
      scenes: storedScenes,
      fonts: storedFonts,
      tunes: storedTunes,
      sceneFxs: storedFx,
      reduceMotion: storedReduce,
      headings: storedHeadings,
      densities: storedDensities,
      statuses: storedStatuses,
      wallpapers: storedWallpapers,
      activeLook: active,
      accentOverride: overrideAccent,
    });
    /* eslint-disable react-hooks/set-state-in-effect */
    setCustomThemes(gated ? [] : loadThemes());
    setSystemDark(
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // The inline script already applied these; re-apply for consistency —
    // from the latest state, which the update above just made the stored
    // look (the React state hasn't committed yet).
    paintLook();
    paintChrome();

    // Re-apply on OS scheme change. Only "system" mode tracks the OS; the
    // repaint itself comes from the latest render (paintSystem above), not
    // from what this effect loaded.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setSystemDark(mq.matches);
      paintSystemRef.current();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // Mount-only: the admin default theme is stable server-provided data;
    // re-running this on a new prop identity would clobber live theme state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The site default can change under an open page — a day/night schedule
  // switch (#336) hands in a new one. Repaint what the visitor hasn't
  // customized from it; the mount effect above is deliberately mount-only.
  // Compared by content: a board page hands in the theme the layout already
  // painted (#337), and that shouldn't repaint.
  const defaultKey = JSON.stringify(defaultTheme);
  const paintedDefault = useRef(defaultKey);
  useEffect(() => {
    if (paintedDefault.current === defaultKey) return;
    paintedDefault.current = defaultKey;
    // The mode too, unless the visitor chose one (a phase can bring its
    // own, as the site's own mode does for an un-customized visitor) — from
    // the site default in force, the usual one for a visitor who turned the
    // schedule off.
    if (!hasOwnMode(policy) && !previewMode) update({ theme: siteOf(latest()).mode });
    paintLook();
    paintChrome();
    // Only a new default should repaint; the callbacks are this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey]);

  const look = useMemo<LookValue>(() => {
    // Resolve the displayed mode (saved `theme`, or a live builder preview) to a
    // lightness, then pick the effective look's matching variant (visitor look,
    // else admin default colors). That variant's background drives the surface-
    // lightness used by theme-aware icons/scenes.
    const isLight =
      displayTheme === "light" || (displayTheme === "system" && !systemDark);
    const displayDark = !isLight;
    const effectiveLook = activeLook ?? adminLook;
    const activeColors: ColorSet | null = effectiveLook
      ? isLight
        ? effectiveLook.light
        : effectiveLook.dark
      : null;
    const surfaceIsLight = activeColors
      ? isLightColor(activeColors.background)
      : isLight;
    return {
      theme,
      resolvedMode: displayDark ? "dark" : "light",
      design: resolveDesign(displayDark),
      scene: resolveScene(displayDark),
      font: resolveFont(displayDark),
      designFor: (mode: Mode) => resolveDesign(mode === "dark"),
      sceneFor: (mode: Mode) => resolveScene(mode === "dark"),
      fontFor: (mode: Mode) => resolveFont(mode === "dark"),
      defaultFontFor: (mode: Mode) => defFont(site, mode === "dark"),
      defaultHeadingFontFor: (mode: Mode) => defHeading(site, mode === "dark"),
      tuneFor: (mode: Mode) => resolveTune(mode === "dark"),
      sceneFxFor: (mode: Mode) => resolveSceneFx(mode === "dark"),
      headingFontFor: (mode: Mode) => resolveHeading(mode === "dark"),
      densityFor: (mode: Mode) => resolveDensity(mode === "dark"),
      statusFor: (mode: Mode) => resolveStatus(mode === "dark"),
      wallpaperFor: (mode: Mode) => resolveWallpaper(mode === "dark"),
      visitorTheming: policy,
      colorsFor: (mode: Mode) => {
        const dark = mode === "dark";
        const cs = variantFor(effectiveLook, dark) ?? seedColorSet(dark);
        const a = resolveAccent(overrideFor(accentOverride, dark), cs, defaultAccent);
        return { ...cs, accentFrom: a.from, accentTo: a.to };
      },
      reduceMotion,
      motion: reduceMotion ? "off" : (resolveSceneFx(displayDark)?.motion ?? "normal"),
      hydrated,
      surfaceIsLight,
      customThemes,
      activeLook,
      activeColors,
      accentOverride,
      activeAccent: resolveAccent(
        overrideFor(accentOverride, displayDark),
        activeColors,
        defaultAccent
      ),
      setTheme,
      setPreviewMode,
      setDesign,
      setScene,
      setFont,
      setTune,
      setSceneFx,
      setReduceMotion,
      setHeadingFont,
      setDensity,
      setStatusColors,
      setWallpaper,
      applyPack,
      applyThemeColors,
      setBaseColors,
      setAccentOverride,
      saveNamedTheme,
      applyNamedTheme,
      captureTheme,
      adoptTheme,
      renameNamedTheme,
      deleteNamedTheme,
      importNamedThemes,
      clearCustomTheme,
      resetTheme,
    };
  }, [
    defaultAccent,
    adminLook,
    site,
    theme,
    displayTheme,
    resolveDesign,
    resolveScene,
    resolveFont,
    resolveTune,
    resolveSceneFx,
    reduceMotion,
    resolveHeading,
    resolveDensity,
    resolveStatus,
    resolveWallpaper,
    policy,
    hydrated,
    seedColorSet,
    systemDark,
    customThemes,
    activeLook,
    accentOverride,
    setTheme,
    setPreviewMode,
    setDesign,
    setScene,
    setFont,
    setTune,
    setSceneFx,
    setReduceMotion,
    setHeadingFont,
    setDensity,
    setStatusColors,
    setWallpaper,
    applyPack,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    captureTheme,
    adoptTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
    clearCustomTheme,
    resetTheme,
  ]);

  return { look, resetLook, followSchedule, setFollowSchedule };
}
