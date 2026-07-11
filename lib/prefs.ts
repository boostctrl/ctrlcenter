// Per-visitor preferences, stored in localStorage. These override the admin
// defaults (timezone, weather location/units) for a single visitor's browser
// only — nothing is written to the server, so any visitor can correct their own
// view without auth and without affecting anyone else.
import {
  DEFAULT_DESIGN,
  DEFAULT_SCENE,
  isDesignId,
  isSceneId,
  type ColorSet,
  type DesignId,
  type ModeColors,
  type SceneId,
} from "./theme";
import { DEFAULT_FONT, isFontId, type FontId } from "./fonts";
import { isValidTimeZone } from "./datetime";

// A value chosen independently per resolved mode. Light and dark each carry their
// own design/scene/font (and colors), so the two can be wholly different themes.
export type ModePair<T> = { dark: T; light: T };

export type Units = "imperial" | "metric";

export type VisitorLocation = {
  latitude: number;
  longitude: number;
  label?: string;
  source: "ip" | "device" | "manual";
};

export type VisitorPrefs = {
  timezone?: string;
  units?: Units;
  location?: VisitorLocation;
  // The "Good evening, <name>!" greeting name. Per-visitor (there is no shared
  // server default) so each browser personalizes its own greeting.
  greetingName?: string;
  // Set once the visitor explicitly reset to defaults, so we don't re-run the
  // automatic IP detection on subsequent loads.
  dismissedAuto?: boolean;
};

export const PREFS_KEY = "ctrlcenter:prefs";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Defensively validate whatever is in localStorage; corrupt or tampered data
// must never break the page or smuggle bad values into the weather request.
export function sanitizePrefs(input: unknown): VisitorPrefs {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const prefs: VisitorPrefs = {};

  if (
    typeof raw.timezone === "string" &&
    raw.timezone.length <= 100 &&
    isValidTimeZone(raw.timezone)
  ) {
    prefs.timezone = raw.timezone;
  }
  if (typeof raw.greetingName === "string" && raw.greetingName.trim()) {
    prefs.greetingName = raw.greetingName.slice(0, 60);
  }
  if (raw.units === "imperial" || raw.units === "metric") {
    prefs.units = raw.units;
  }
  if (raw.dismissedAuto === true) {
    prefs.dismissedAuto = true;
  }

  const loc = raw.location as Record<string, unknown> | undefined;
  if (
    loc &&
    isFiniteNumber(loc.latitude) &&
    isFiniteNumber(loc.longitude) &&
    loc.latitude >= -90 &&
    loc.latitude <= 90 &&
    loc.longitude >= -180 &&
    loc.longitude <= 180
  ) {
    const source =
      loc.source === "ip" || loc.source === "device" || loc.source === "manual"
        ? loc.source
        : "manual";
    prefs.location = {
      latitude: loc.latitude,
      longitude: loc.longitude,
      source,
      ...(typeof loc.label === "string" && loc.label
        ? { label: loc.label.slice(0, 80) }
        : {}),
    };
  }

  return prefs;
}

export function loadPrefs(): VisitorPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: VisitorPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / quota — preferences just won't persist.
  }
}

// --- Favorites ---
// Per-visitor pinned app IDs, surfaced in a Favorites row at the top of the
// dashboard. Stored as a JSON string array (pin order preserved); unknown or
// deleted IDs are ignored at render time. Purely client-side — never written to
// the server config.
export const FAVORITES_KEY = "ctrlcenter:favorites";

export function loadFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Private mode / quota — favorites just won't persist.
  }
}

export function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// All IANA zones, for the editor's timezone picker (falls back to empty if the
// runtime doesn't support it).
export function supportedTimezones(): string[] {
  try {
    const fn = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}

// --- Custom themes (the theme builder) ---
// A single color set: page background, the "ink" color (text + surfaces/borders
// via opacity), and the accent gradient endpoints. Re-exported from lib/theme.
export type ThemeColors = ColorSet;

// A saved theme bundles a cohesive light+dark color pair with the design, scene
// and font each mode was saved with, so applying it restores two complete,
// independent looks. The unsuffixed fields are the dark-mode parts; the
// `*Light` fields the light-mode parts (colors come from ModeColors' dark/light).
export type CustomTheme = ModeColors & {
  id: string;
  name: string;
  design: DesignId;
  scene: SceneId;
  font: FontId;
  designLight: DesignId;
  sceneLight: SceneId;
  fontLight: FontId;
};

// The active custom look's light+dark colors (the resolved mode selects which
// is applied). Per-visitor, stored in localStorage.
export const ACTIVE_THEME_KEY = "ctrlcenter:activeTheme";
// The visitor's saved, named themes.
export const THEMES_KEY = "ctrlcenter:themes";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeColors(input: unknown): ColorSet | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
  if (ok(c.background) && ok(c.foreground) && ok(c.accentFrom) && ok(c.accentTo)) {
    return {
      background: c.background,
      foreground: c.foreground,
      accentFrom: c.accentFrom,
      accentTo: c.accentTo,
    };
  }
  return null;
}

// Parse a light+dark pair. Back-compat: a value saved before looks were
// mode-aware is a single color set — wrap it as both modes so the look still
// applies (it just looks the same in light and dark until re-saved).
export function sanitizeModeColors(input: unknown): ModeColors | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const dark = sanitizeColors(c.dark);
  const light = sanitizeColors(c.light);
  if (dark && light) return { dark, light };
  const flat = sanitizeColors(input);
  return flat ? { dark: flat, light: flat } : null;
}

export function loadActiveTheme(): ModeColors | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_THEME_KEY);
    return raw ? sanitizeModeColors(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveActiveTheme(colors: ModeColors | null): void {
  if (typeof window === "undefined") return;
  try {
    if (colors) {
      window.localStorage.setItem(ACTIVE_THEME_KEY, JSON.stringify(colors));
    } else {
      window.localStorage.removeItem(ACTIVE_THEME_KEY);
    }
  } catch {
    // ignore
  }
}

// Map a saved theme onto the site-default theme object for promotion (#142):
// dark parts fill the base fields, light parts the *Light fields, including
// the per-mode accent pair. The pack presets are deliberately absent — the
// settings API replaces the theme wholesale, so omitting them clears them and
// the admin Appearance picker correctly reads "Custom" afterwards. A test
// pins this mapping against the settings schema's key list, so a new theme
// field can't be silently dropped from promotion.
export function siteThemeFromCustomTheme(
  theme: CustomTheme,
  mode: "system" | "light" | "dark"
) {
  return {
    mode,
    design: theme.design,
    scene: theme.scene,
    font: theme.font,
    designLight: theme.designLight,
    sceneLight: theme.sceneLight,
    fontLight: theme.fontLight,
    accentFrom: theme.dark.accentFrom,
    accentTo: theme.dark.accentTo,
    accentFromLight: theme.light.accentFrom,
    accentToLight: theme.light.accentTo,
    background: theme.dark.background,
    foreground: theme.dark.foreground,
    backgroundLight: theme.light.background,
    foregroundLight: theme.light.foreground,
  };
}

// Validate one stored/imported entry into a CustomTheme, or null if it's
// unusable. Carries the load-time migrations: flat colors wrap into both modes
// (sanitizeModeColors), pre-designs/scenes themes default to Glass/Aurora, and
// pre-independent themes fall back to their dark-mode design/scene/font for
// light. One relaxation over a strict parse — a missing/non-string id is minted
// rather than dropping the whole entry, so an import that omits ids still lands.
export function sanitizeCustomTheme(input: unknown): CustomTheme | null {
  const colors = sanitizeModeColors(input);
  const t = input as Record<string, unknown> | null;
  if (!colors || !t || typeof t.name !== "string") return null;
  const design = isDesignId(t.design) ? t.design : DEFAULT_DESIGN;
  const scene = isSceneId(t.scene) ? t.scene : DEFAULT_SCENE;
  const font = isFontId(t.font) ? t.font : DEFAULT_FONT;
  const designLight = isDesignId(t.designLight) ? t.designLight : design;
  const sceneLight = isSceneId(t.sceneLight) ? t.sceneLight : scene;
  const fontLight = isFontId(t.fontLight) ? t.fontLight : font;
  return {
    id: typeof t.id === "string" ? t.id : newThemeId(),
    name: t.name.slice(0, 40),
    design,
    scene,
    font,
    designLight,
    sceneLight,
    fontLight,
    ...colors,
  };
}

export function loadThemes(): CustomTheme[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(THEMES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((t) => {
      const theme = sanitizeCustomTheme(t);
      return theme ? [theme] : [];
    });
  } catch {
    return [];
  }
}

// Parse a themes-export file into sanitized themes, forgiving about the exact
// shape: a bare array of themes (what our own export writes), a single theme
// object, or an object with a `themes` array. Every id is re-minted — ids from a
// file can collide with themes already in this browser's list, and the importer
// de-dupes on content, not id. Returns [] for anything unusable.
export function parseThemesExport(input: unknown): CustomTheme[] {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  const list: unknown[] = Array.isArray(input)
    ? input
    : obj && Array.isArray(obj.themes)
      ? obj.themes
      : obj
        ? [obj]
        : [];
  return list.flatMap((t) => {
    const theme = sanitizeCustomTheme(t);
    return theme ? [{ ...theme, id: newThemeId() }] : [];
  });
}

// Returns whether the write landed, so the theme builder can tell the visitor
// when storage is unavailable (private mode / quota) instead of silently
// showing a theme that would vanish on reload.
export function saveThemes(themes: CustomTheme[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
    return true;
  } catch {
    return false;
  }
}

// Mint an id for a saved theme. crypto.randomUUID() only exists in secure
// contexts (HTTPS/localhost), and this app is routinely self-hosted over plain
// HTTP on a LAN — so fall back to getRandomValues, which is available
// everywhere; the id only needs to be unique within one browser's saved list.
export function newThemeId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

// --- Accent override ---
// The accent gradient can be changed on its own, independently of a full custom
// theme: picking an accent leaves the background/foreground as-is (following the
// light/dark mode, or a custom theme's colors). Chosen per mode — light and dark
// each carry their own override (a null per mode means no override there).
// Per-visitor; overrides the admin-configured default accent when present.
export type AccentColors = { from: string; to: string };

export type AccentOverrides = ModePair<AccentColors | null>;

export const NO_ACCENT_OVERRIDES: AccentOverrides = { dark: null, light: null };

export const ACCENT_KEY = "ctrlcenter:accent";

export function sanitizeAccent(input: unknown): AccentColors | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
  return ok(c.from) && ok(c.to) ? { from: c.from, to: c.to } : null;
}

// Parse the stored override pair. Back-compat: a value saved before accents were
// per-mode is a flat {from,to} — read it as an override for both modes, so the
// visitor's accent survives the upgrade unchanged.
export function sanitizeAccentOverrides(input: unknown): AccentOverrides {
  if (!input || typeof input !== "object") return NO_ACCENT_OVERRIDES;
  const o = input as Record<string, unknown>;
  if ("dark" in o || "light" in o) {
    return { dark: sanitizeAccent(o.dark), light: sanitizeAccent(o.light) };
  }
  const flat = sanitizeAccent(input);
  return flat ? { dark: flat, light: flat } : NO_ACCENT_OVERRIDES;
}

export function loadAccentOverride(): AccentOverrides {
  if (typeof window === "undefined") return NO_ACCENT_OVERRIDES;
  try {
    const raw = window.localStorage.getItem(ACCENT_KEY);
    return raw ? sanitizeAccentOverrides(JSON.parse(raw)) : NO_ACCENT_OVERRIDES;
  } catch {
    return NO_ACCENT_OVERRIDES;
  }
}

export function saveAccentOverride(accents: AccentOverrides | null): void {
  if (typeof window === "undefined") return;
  try {
    if (accents && (accents.dark || accents.light)) {
      window.localStorage.setItem(
        ACCENT_KEY,
        JSON.stringify({ dark: accents.dark, light: accents.light })
      );
    } else {
      window.localStorage.removeItem(ACCENT_KEY);
    }
  } catch {
    // ignore
  }
}

// --- Per-mode design / scene / font ---
// Each is chosen independently for light and dark, so the two modes can be wholly
// different looks. Stored as a `{dark,light}` JSON object under the same key; a
// legacy bare-string value (saved before modes were independent) is read as both
// modes. A null per mode means the visitor hasn't chosen for that mode, so the
// caller falls back to the admin-configured default.
function loadModePair<T>(
  key: string,
  valid: (v: unknown) => v is T
): ModePair<T | null> {
  if (typeof window === "undefined") return { dark: null, light: null };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { dark: null, light: null };
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A bare legacy value like `flat` isn't valid JSON; use the raw string.
      parsed = raw;
    }
    if (typeof parsed === "string") {
      const v = valid(parsed) ? parsed : null;
      return { dark: v, light: v };
    }
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      return {
        dark: valid(o.dark) ? o.dark : null,
        light: valid(o.light) ? o.light : null,
      };
    }
    return { dark: null, light: null };
  } catch {
    return { dark: null, light: null };
  }
}

function saveModePair<T extends string>(
  key: string,
  pair: ModePair<T | null> | null
): void {
  if (typeof window === "undefined") return;
  try {
    if (pair && (pair.dark || pair.light)) {
      window.localStorage.setItem(
        key,
        JSON.stringify({ dark: pair.dark, light: pair.light })
      );
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

// The look-and-feel preset (Glass, Flat, Bold, …), per mode. Applied as a
// `design-<id>` class on <html>. See lib/theme.ts for the catalog.
export const DESIGN_KEY = "ctrlcenter:design";

export function loadDesign(): ModePair<DesignId | null> {
  return loadModePair(DESIGN_KEY, isDesignId);
}

export function saveDesign(design: ModePair<DesignId | null> | null): void {
  saveModePair(DESIGN_KEY, design);
}

// The backdrop + ornament preset (Aurora, Abyss, …), per mode. Applied as a
// `scene-<id>` class on <html> and rendered by <SceneLayer>. See lib/theme.ts.
export const SCENE_KEY = "ctrlcenter:scene";

export function loadScene(): ModePair<SceneId | null> {
  return loadModePair(SCENE_KEY, isSceneId);
}

export function saveScene(scene: ModePair<SceneId | null> | null): void {
  saveModePair(SCENE_KEY, scene);
}

// The UI typeface (Plus Jakarta Sans, Inter, …), per mode. Applied as a
// `font-<id>` class on <html>. See lib/fonts.ts for the catalog.
export const FONT_KEY = "ctrlcenter:font";

export function loadFont(): ModePair<FontId | null> {
  return loadModePair(FONT_KEY, isFontId);
}

export function saveFont(font: ModePair<FontId | null> | null): void {
  saveModePair(FONT_KEY, font);
}
