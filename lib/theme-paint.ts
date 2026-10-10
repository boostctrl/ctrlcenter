// The one theme resolver (#325). Everything that turns a theme state into what
// gets painted on <html> — the mode class, the surface/accent CSS variables,
// the accent ink, the deepened scene colors, the per-theme ink lift and the
// design/scene/font classes — lives in makeThemePaint() below, and runs in two
// places from this single source:
//
//   1. Before first paint, as the inline no-flash script app/layout.tsx emits:
//      inlineThemeScript() embeds `makeThemePaint.toString()` and calls it in
//      the browser, so the pre-hydration paint is the same code the app runs.
//   2. After hydration, through `themePaint` (the module-level instance) used
//      by components/prefs/themeApply.ts and the canvas scenes.
//
// Because the factory's source is serialized with Function.prototype.toString,
// it MUST be self-contained: no imports, no references to anything outside its
// own body (the bundler may rename module-level identifiers, and the inline
// copy would then reference a name that doesn't exist). The helpers it returns
// are reached as properties of the returned object, which minifiers leave
// alone. Keep its syntax plain (no `?.`, `??`, spread or class fields) so the
// embedded copy runs unchanged in any browser the app supports. A test
// evaluates the serialized source in isolation to catch a stray outer reference.

// The site default theme as the inline script receives it (the server's
// settings.theme, already validated by the schema).
// A tune (lib/theme.ts Tune): each knob a percentage of the design's value.
export type PaintTune = Record<string, number>;

export type PaintDefaults = {
  mode: "system" | "light" | "dark";
  design: string;
  scene: string;
  font: string;
  designLight?: string;
  sceneLight?: string;
  fontLight?: string;
  accentFrom: string;
  accentTo: string;
  accentFromLight?: string;
  accentToLight?: string;
  background?: string;
  foreground?: string;
  backgroundLight?: string;
  foregroundLight?: string;
  tune?: PaintTune;
  tuneLight?: PaintTune;
  // Scene effects (#327): intensity 0–100, motion normal | calm | off.
  sceneIntensity?: number;
  sceneMotion?: string;
  sceneIntensityLight?: number;
  sceneMotionLight?: string;
  // Typography (#330): a heading font (unset = the body font) and a density.
  headingFont?: string;
  headingFontLight?: string;
  density?: string;
  densityLight?: string;
  // Semantic colors (#331), per mode: { up, down, warning, info } hex.
  status?: PaintSemantic;
  statusLight?: PaintSemantic;
  // A wallpaper (#333), per mode.
  wallpaper?: PaintWallpaper;
  wallpaperLight?: PaintWallpaper;
  // What this visitor may change (#335): "all" (or unset), "packs" or
  // "none". Under "packs" the site's themes come along, since a stored theme
  // choice is then a pack's name, resolved here.
  policy?: string;
  packs?: PaintPack[];
};

export type PaintColorSet = { background: string; foreground: string; accentFrom: string; accentTo: string };

// A gallery pack as the no-flash script needs it (#335).
export type PaintPack = {
  name: string;
  design: string;
  scene: string;
  designLight?: string;
  sceneLight?: string;
  dark: PaintColorSet;
  light: PaintColorSet;
  tune?: PaintTune;
  font?: string;
  headingFont?: string;
  status?: PaintSemantic;
  statusLight?: PaintSemantic;
  wallpaper?: PaintWallpaper;
  wallpaperLight?: PaintWallpaper;
};

export type PaintWallpaper = { src: string; blur: number; dim: number; fit: string };

export type PaintSemantic = Record<string, string>;

// The valid ids per part, so a stored value the current build doesn't know
// falls back to the default instead of adding a dead class.
export type PaintIds = {
  design: readonly string[];
  scene: readonly string[];
  font: readonly string[];
  density: readonly string[];
};

// The resolved state for the mode on screen. `background`/`foreground` are
// null when no look applies (the CSS :root / .theme-light defaults show).
// `design`/`scene`/`font` are optional: applyAll() leaves the classes to the
// per-part setters, while the no-flash script sets everything at once.
export type PaintInput = {
  dark: boolean;
  background: string | null;
  foreground: string | null;
  accentFrom: string;
  accentTo: string;
  // The fine-tune over the design (null = the design untouched).
  tune?: PaintTune | null;
  // The scene's effects (null = as designed), and the visitor's Reduce motion
  // switch, which stills every scene whatever the effects say (#327).
  sceneFx?: { intensity: number; motion: string } | null;
  reduceMotion?: boolean;
  design?: string;
  scene?: string;
  font?: string;
  // The heading font (null = the body font) and the density (#330).
  headingFont?: string | null;
  density?: string | null;
  // The theme's semantic colors (null = the stylesheet's defaults).
  status?: PaintSemantic | null;
  // The wallpaper behind the scene (null = none).
  wallpaper?: PaintWallpaper | null;
};

// What to paint: `vars` maps a CSS custom property to its value, or null to
// remove it from <html> so the stylesheet's own value applies.
export type Paint = {
  dark: boolean;
  vars: Record<string, string | null>;
  // Attributes on <html> (null = remove): data-motion for the stylesheet.
  attrs: Record<string, string | null>;
  design?: string;
  scene?: string;
  font?: string;
  headingFont?: string | null;
  density?: string | null;
};

// The ids that carry no class (the :root tokens).
const DEFAULT_DESIGN_ID = "glass";
const DEFAULT_SCENE_ID = "aurora";
const DEFAULT_FONT_ID = "jakarta";

export function makeThemePaint() {
  const HEX = /^#?([0-9a-fA-F]{6})$/;
  // The heaviest common card fill (ink over the page), see inkLift.
  const CARD_FILL = 0.1;
  // The tune knobs, each painted as --tune-<key> (a multiplier; 100% = 1).
  const TUNE = ["radius", "border", "blur", "shadow", "fill", "glow"];
  // The density factors, by id (lib/theme.ts DENSITIES).
  const DENSITY: Record<string, number> = { compact: 0.85, comfortable: 1, spacious: 1.15 };
  // The semantic color keys, each painted as --status-<key>.
  const SEMANTIC = ["up", "down", "warning", "info"];
  // A wallpaper source: http(s) or a same-origin path, nothing that could
  // break out of a quoted CSS url().
  const WALLPAPER_SRC = /^(https?:\/\/[^\s\x00-\x1f"'()\\]+|\/(?!\/)[^\s\x00-\x1f"'()\\]*)$/;
  const FITS: Record<string, [string, string]> = {
    cover: ["cover", "no-repeat"],
    contain: ["contain", "no-repeat"],
    tile: ["auto", "repeat"],
  };

  function hexToRgb(hex: string): [number, number, number] | null {
    const m = HEX.exec((hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Perceived luminance (0–1): the quick Rec. 601 weighting, used to decide
  // whether a surface reads as light (theme-aware icons). Non-hex is mid-gray.
  function luminance(hex: string): number {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0.5;
    return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  }

  // WCAG relative luminance (sRGB linearized), for contrast ratios.
  function relativeLuminance(hex: string): number {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0.5;
    let out = 0;
    const w = [0.2126, 0.7152, 0.0722];
    for (let i = 0; i < 3; i++) {
      const c = rgb[i] / 255;
      out += w[i] * (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    }
    return out;
  }

  // WCAG contrast ratio (1–21) between two #rrggbb colors.
  function contrast(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const hi = la > lb ? la : lb;
    const lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  // The ink for text sitting on the accent (.btn-accent, the selected-option
  // check, the calendar's today): black or white, whichever contrasts more
  // with the stop that is actually painted (#321). Measured, not guessed from
  // an averaged luminance — a bright start stop with a darker end stop used to
  // get white text at 1.6:1.
  function accentInk(accent: string): string {
    return contrast("#000000", accent) >= contrast("#ffffff", accent) ? "#000000" : "#ffffff";
  }

  // Deepen + saturate a #rrggbb accent for the light surface: keep the hue,
  // drop the lightness and push saturation so backdrops and the focus ring
  // read as a vivid burst over near-white rather than a pale wash. Returns an
  // "r, g, b" string (the canvas scenes build rgba() from it).
  function deepenForLight(hex: string): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return "150, 180, 240";
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let l = (max + min) / 2;
    let s = 0;
    let h = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    l = l * 0.6;
    s = Math.min(1, s * 1.15);
    const hue = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const to = (t: number) => Math.round(hue(p, q, t) * 255);
    return to(h + 1 / 3) + ", " + to(h) + ", " + to(h - 1 / 3);
  }

  // The scene color for a mode: the raw accent on dark, deepened on light.
  function sceneColor(accent: string, dark: boolean): string {
    return dark ? accent : "rgb(" + deepenForLight(accent) + ")";
  }

  // Alpha-composite `fg` over `bg` at `alpha`, as "#rrggbb".
  function blend(bg: string, fg: string, alpha: number): string {
    const a = hexToRgb(bg);
    const b = hexToRgb(fg);
    if (!a || !b) return fg;
    let out = "#";
    for (let i = 0; i < 3; i++) {
      const v = Math.round(a[i] * (1 - alpha) + b[i] * alpha);
      out += (v < 16 ? "0" : "") + v.toString(16);
    }
    return out;
  }

  // The secondary-ink lift for a look (#322). `text-ink-NN` renders the ink
  // at NN% opacity lifted part-way toward opaque by --ink-lift (see
  // app/globals.css). The stylesheet's per-mode constants (0.15 dark, 0.4
  // light) were tuned so the DEFAULT colors clear 4.5:1 at the /40 step; a
  // palette with a lower-contrast ink pair needs more. This finds the smallest
  // lift at which /40 — the lowest step in common use — reads at 4.5:1, never
  // below the mode's floor so no look gets less lift than today. It measures
  // against a card's fill rather than the bare page: every design tints its
  // surface a little toward the ink (Glass 4%, Paper 10%), which costs
  // contrast, so a 10% fill stands in for the heaviest common case. A pair
  // that can't reach 4.5:1 even opaque gets the full lift.
  function inkLift(background: string, foreground: string, dark: boolean): number {
    const floor = dark ? 0.15 : 0.4;
    const step = 0.4;
    const target = 4.5;
    const surface = blend(background, foreground, CARD_FILL);
    if (contrast(surface, foreground) < target) return 1;
    // Binary-search the alpha that just clears the target.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(surface, blend(surface, foreground, mid)) >= target) hi = mid;
      else lo = mid;
    }
    // alpha = 1 - (1 - step) * (1 - lift)  ⇒  lift = 1 - (1 - alpha) / (1 - step)
    const lift = 1 - (1 - hi) / (1 - step);
    const rounded = Math.ceil(lift * 100) / 100;
    return rounded < floor ? floor : rounded > 1 ? 1 : rounded;
  }

  // Everything to paint for a resolved state.
  function computePaint(input: PaintInput): Paint {
    const vars: Record<string, string | null> = {};
    const hasLook = !!(input.background && input.foreground);
    vars["--background"] = hasLook ? input.background : null;
    vars["--foreground"] = hasLook ? input.foreground : null;
    vars["--fg"] = hasLook ? input.foreground : null;
    vars["--ink-lift"] = hasLook
      ? String(inkLift(input.background as string, input.foreground as string, input.dark))
      : null;
    vars["--accent-from"] = input.accentFrom;
    vars["--accent-to"] = input.accentTo;
    vars["--accent-fg"] = accentInk(input.accentFrom);
    vars["--scene-from"] = sceneColor(input.accentFrom, input.dark);
    vars["--scene-to"] = sceneColor(input.accentTo, input.dark);
    for (let i = 0; i < TUNE.length; i++) {
      const k = TUNE[i];
      const v = input.tune ? input.tune[k] : undefined;
      vars["--tune-" + k] = typeof v === "number" && isFinite(v) && v !== 100 ? String(v / 100) : null;
    }
    const fx = input.sceneFx;
    const intensity = fx && typeof fx.intensity === "number" && isFinite(fx.intensity) ? fx.intensity : 100;
    vars["--scene-opacity"] = intensity !== 100 ? String(Math.min(100, Math.max(0, intensity)) / 100) : null;
    const motion = input.reduceMotion ? "off" : fx && (fx.motion === "calm" || fx.motion === "off") ? fx.motion : "normal";
    const attrs: Record<string, string | null> = {};
    attrs["data-motion"] = motion === "normal" ? null : motion;
    const factor = input.density ? DENSITY[input.density] : undefined;
    vars["--density"] = factor !== undefined && factor !== 1 ? String(factor) : null;
    for (let i = 0; i < SEMANTIC.length; i++) {
      const k = SEMANTIC[i];
      const v = input.status ? input.status[k] : undefined;
      vars["--status-" + k] = typeof v === "string" && HEX.test(v) ? v : null;
    }
    const wp = input.wallpaper;
    if (wp && typeof wp.src === "string" && WALLPAPER_SRC.test(wp.src) && wp.src.length <= 2048) {
      const fit = FITS[wp.fit] || FITS.cover;
      const blur = typeof wp.blur === "number" && isFinite(wp.blur) ? Math.min(40, Math.max(0, Math.round(wp.blur))) : 0;
      const dim = typeof wp.dim === "number" && isFinite(wp.dim) ? Math.min(100, Math.max(0, Math.round(wp.dim))) : 0;
      vars["--wallpaper-image"] = 'url("' + wp.src + '")';
      vars["--wallpaper-blur"] = blur + "px";
      vars["--wallpaper-dim"] = String(dim / 100);
      vars["--wallpaper-size"] = fit[0];
      vars["--wallpaper-repeat"] = fit[1];
    } else {
      vars["--wallpaper-image"] = null;
      vars["--wallpaper-blur"] = null;
      vars["--wallpaper-dim"] = null;
      vars["--wallpaper-size"] = null;
      vars["--wallpaper-repeat"] = null;
    }
    const paint: Paint = { dark: input.dark, vars: vars, attrs: attrs };
    if (input.design !== undefined) paint.design = input.design;
    if (input.scene !== undefined) paint.scene = input.scene;
    if (input.font !== undefined) paint.font = input.font;
    if (input.headingFont !== undefined) paint.headingFont = input.headingFont;
    return paint;
  }

  // Paint onto <html>. The mode class ALWAYS tracks the resolved mode; vars are
  // set or removed; the design/scene/font classes are swapped only when the
  // paint carries that part (the defaults carry no class).
  function apply(el: HTMLElement, paint: Paint, ids: PaintIds): void {
    el.classList.toggle("theme-light", !paint.dark);
    const s = el.style;
    for (const name in paint.vars) {
      const v = paint.vars[name];
      if (v === null) s.removeProperty(name);
      else s.setProperty(name, v);
    }
    for (const name in paint.attrs) {
      const v = paint.attrs[name];
      if (v === null) el.removeAttribute(name);
      else el.setAttribute(name, v);
    }
    const parts: [string, string | undefined, readonly string[], string][] = [
      ["design-", paint.design, ids.design, DEFAULT_DESIGN_ID],
      ["scene-", paint.scene, ids.scene, DEFAULT_SCENE_ID],
      ["font-", paint.font, ids.font, DEFAULT_FONT_ID],
      // The heading font has no default id: null means "the body font", so
      // every heading-* class comes off and none goes on.
      ["heading-", paint.headingFont === null ? "" : paint.headingFont, ids.font, ""],
    ];
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts[i][0];
      const value = parts[i][1];
      if (value === undefined) continue;
      const valid = parts[i][2];
      for (let j = 0; j < valid.length; j++) el.classList.remove(prefix + valid[j]);
      if (value !== parts[i][3] && valid.indexOf(value) >= 0) el.classList.add(prefix + value);
    }
  }

  // Resolve the stored visitor choices + the site default into a PaintInput —
  // the no-flash path. `storage` is localStorage (or anything with getItem).
  // Precedence, part by part: the visitor's stored value wins, then the admin
  // default. Tolerant of garbage: anything unparsable is ignored.
  function readStored(
    source: { getItem(key: string): string | null },
    dt: PaintDefaults,
    ids: PaintIds,
    prefersDark: boolean
  ): PaintInput {
    // What this visitor may change (#335): under "packs" only the mode, the
    // Reduce motion switch and the chosen pack's name are read; under "none"
    // only the switch. Everything else stored is left be, unread — so a
    // browser customized before the policy changed falls back at once.
    const policy = dt.policy === "packs" || dt.policy === "none" ? dt.policy : "all";
    const allowed =
      policy === "all" ? null : policy === "packs" ? ["ctrlcenter:theme", "ctrlcenter:motion", "ctrlcenter:pack"] : ["ctrlcenter:motion"];
    const storage = allowed
      ? { getItem: (key: string) => (allowed.indexOf(key) >= 0 ? source.getItem(key) : null) }
      : source;
    const get = (key: string): unknown => {
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
    const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

    let mode: string = dt.mode;
    try {
      const m = storage.getItem("ctrlcenter:theme");
      if (m === "light" || m === "dark" || m === "system") mode = m;
    } catch {
      // ignore
    }
    const dark = mode === "dark" || (mode === "system" && prefersDark);

    // Under "packs", the chosen pack for this mode stands in for the site
    // default: its design, scene, colors, tune and the parts it carries, the
    // way applying it in the builder sets them (a pack without a font or
    // heading font leaves the default's; without a wallpaper, none).
    if (policy === "packs" && dt.packs) {
      const choice = get("ctrlcenter:pack");
      const name = isObj(choice) ? (dark ? choice.dark : choice.light) : null;
      let pack: PaintPack | null = null;
      for (let i = 0; i < dt.packs.length; i++) if (dt.packs[i].name === name) pack = dt.packs[i];
      if (pack) {
        const pcs = dark ? pack.dark : pack.light;
        const pd: PaintDefaults = {
          mode: dt.mode,
          design: dark ? pack.design : pack.designLight || pack.design,
          scene: dark ? pack.scene : pack.sceneLight || pack.scene,
          font: pack.font || (dark ? dt.font : dt.fontLight || dt.font),
          accentFrom: pcs.accentFrom,
          accentTo: pcs.accentTo,
          background: pcs.background,
          foreground: pcs.foreground,
          tune: pack.tune,
          sceneIntensity: dark ? dt.sceneIntensity : dt.sceneIntensityLight === undefined ? dt.sceneIntensity : dt.sceneIntensityLight,
          sceneMotion: dark ? dt.sceneMotion : dt.sceneMotionLight === undefined ? dt.sceneMotion : dt.sceneMotionLight,
          headingFont: pack.headingFont || (dark ? dt.headingFont : dt.headingFontLight || dt.headingFont),
          density: dark ? dt.density : dt.densityLight || dt.density,
          status: (dark ? pack.status : pack.statusLight || pack.status) || (dark ? dt.status : dt.statusLight || dt.status),
          wallpaper: dark ? pack.wallpaper : pack.wallpaperLight || pack.wallpaper,
        };
        dt = pd;
      }
    }

    // The active look: a {dark,light} pair, a flat pre-mode color set (both
    // modes), else the admin custom default colors, else none.
    type CS = { background: string; foreground: string; accentFrom: string; accentTo: string };
    const colorSet = (o: unknown): CS | null =>
      isObj(o) && isHex(o.background) && isHex(o.foreground) && isHex(o.accentFrom) && isHex(o.accentTo)
        ? { background: o.background, foreground: o.foreground, accentFrom: o.accentFrom, accentTo: o.accentTo }
        : null;
    let look: { dark: CS; light: CS } | null = null;
    const stored = get("ctrlcenter:activeTheme");
    if (isObj(stored)) {
      const d = colorSet(stored.dark);
      const l = colorSet(stored.light);
      if (d && l) look = { dark: d, light: l };
      else {
        const flat = colorSet(stored);
        if (flat) look = { dark: flat, light: flat };
      }
    }
    if (!look && dt.background && dt.foreground) {
      look = {
        dark: {
          background: dt.background,
          foreground: dt.foreground,
          accentFrom: dt.accentFrom,
          accentTo: dt.accentTo,
        },
        light: {
          background: dt.backgroundLight || dt.background,
          foreground: dt.foregroundLight || dt.foreground,
          accentFrom: dt.accentFromLight || dt.accentFrom,
          accentTo: dt.accentToLight || dt.accentTo,
        },
      };
    }
    const cs = look ? (dark ? look.dark : look.light) : null;

    // The accent: a per-mode override, else the look's own, else the default.
    let accentFrom = cs ? cs.accentFrom : dt.accentFrom;
    let accentTo = cs ? cs.accentTo : dt.accentTo;
    let override = get("ctrlcenter:accent");
    if (isObj(override) && ("dark" in override || "light" in override)) {
      override = dark ? override.dark : override.light;
    }
    if (isObj(override) && isHex(override.from) && isHex(override.to)) {
      accentFrom = override.from;
      accentTo = override.to;
    }

    // The tune: the stored per-mode pair, else the admin default for the mode
    // (light falls back to the dark tune). Knobs are clamped like the app's
    // sanitizeTune; a value that isn't a finite number is left at 100.
    const tuneOf = (o: unknown): PaintTune | null => {
      if (!isObj(o)) return null;
      const out: PaintTune = {};
      let any = false;
      for (let i = 0; i < TUNE.length; i++) {
        const v = o[TUNE[i]];
        if (typeof v !== "number" || !isFinite(v)) continue;
        out[TUNE[i]] = Math.min(300, Math.max(0, Math.round(v)));
        any = true;
      }
      return any ? out : null;
    };
    const storedTune = get("ctrlcenter:tune");
    let tune = isObj(storedTune) ? tuneOf(dark ? storedTune.dark : storedTune.light) : null;
    if (!tune) tune = tuneOf(dark ? dt.tune : dt.tuneLight || dt.tune);

    // Scene effects: the stored per-mode pair, else the admin default for the
    // mode (light falls back to dark). The Reduce motion switch is its own key.
    const fxOf = (o: unknown): { intensity: number; motion: string } | null => {
      if (!isObj(o)) return null;
      const out = { intensity: 100, motion: "normal" };
      let any = false;
      if (typeof o.intensity === "number" && isFinite(o.intensity)) {
        out.intensity = Math.min(100, Math.max(0, Math.round(o.intensity)));
        any = true;
      }
      if (o.motion === "normal" || o.motion === "calm" || o.motion === "off") {
        out.motion = o.motion;
        any = true;
      }
      return any ? out : null;
    };
    const storedFx = get("ctrlcenter:scene-fx");
    let sceneFx = isObj(storedFx) ? fxOf(dark ? storedFx.dark : storedFx.light) : null;
    if (!sceneFx) {
      sceneFx = fxOf(
        dark
          ? { intensity: dt.sceneIntensity, motion: dt.sceneMotion }
          : {
              intensity: dt.sceneIntensityLight === undefined ? dt.sceneIntensity : dt.sceneIntensityLight,
              motion: dt.sceneMotionLight === undefined ? dt.sceneMotion : dt.sceneMotionLight,
            }
      );
    }
    let reduceMotion = false;
    try {
      reduceMotion = storage.getItem("ctrlcenter:motion") === "reduce";
    } catch {
      // ignore
    }

    // Design / scene / font: the stored per-mode pair, validated against the
    // ids this build knows, else the admin default for the mode.
    const pick = (key: string, valid: readonly string[], dd: string, dl: string | undefined): string => {
      const o = get(key);
      const v = isObj(o) ? (dark ? o.dark : o.light) : null;
      if (typeof v === "string" && valid.indexOf(v) >= 0) return v;
      return dark ? dd : dl || dd;
    };
    // Semantic colors: the stored per-mode set, else the admin default for
    // the mode (light falls back to dark); all four must be hex.
    const semOf = (o: unknown): PaintSemantic | null => {
      if (!isObj(o)) return null;
      const out: PaintSemantic = {};
      for (let i = 0; i < SEMANTIC.length; i++) {
        const v = o[SEMANTIC[i]];
        if (!isHex(v)) return null;
        out[SEMANTIC[i]] = v;
      }
      return out;
    };
    const storedStatus = get("ctrlcenter:status");
    let status = isObj(storedStatus) ? semOf(dark ? storedStatus.dark : storedStatus.light) : null;
    if (!status) status = semOf(dark ? dt.status : dt.statusLight || dt.status);

    // The wallpaper: the stored per-mode one (a stored src of "" is the
    // visitor's "none", over an admin default), else the admin default.
    const wpOf = (o: unknown): PaintWallpaper | null => {
      if (!isObj(o) || typeof o.src !== "string" || !WALLPAPER_SRC.test(o.src)) return null;
      return {
        src: o.src,
        blur: typeof o.blur === "number" ? o.blur : 0,
        dim: typeof o.dim === "number" ? o.dim : 0,
        fit: typeof o.fit === "string" ? o.fit : "cover",
      };
    };
    const storedWp = get("ctrlcenter:wallpaper");
    const wpRaw = isObj(storedWp) ? (dark ? storedWp.dark : storedWp.light) : null;
    let wallpaper: PaintWallpaper | null = null;
    if (isObj(wpRaw) && wpRaw.src === "") wallpaper = null;
    else {
      wallpaper = wpOf(wpRaw);
      if (!wallpaper) wallpaper = wpOf(dark ? dt.wallpaper : dt.wallpaperLight || dt.wallpaper);
    }

    // The heading font: stored pair, else the admin default (light falls
    // back to dark); none means the body font. The visitor's stored "body"
    // sentinel clears the admin default.
    const headingStored = get("ctrlcenter:heading");
    const headingRaw = isObj(headingStored) ? (dark ? headingStored.dark : headingStored.light) : null;
    let headingFont: string | null = null;
    if (typeof headingRaw === "string" && ids.font.indexOf(headingRaw) >= 0) headingFont = headingRaw;
    else if (headingRaw !== "body") {
      const dh = dark ? dt.headingFont : dt.headingFontLight || dt.headingFont;
      if (typeof dh === "string" && ids.font.indexOf(dh) >= 0) headingFont = dh;
    }

    return {
      dark: dark,
      background: cs ? cs.background : null,
      foreground: cs ? cs.foreground : null,
      accentFrom: accentFrom,
      accentTo: accentTo,
      tune: tune,
      sceneFx: sceneFx,
      reduceMotion: reduceMotion,
      design: pick("ctrlcenter:design", ids.design, dt.design, dt.designLight),
      scene: pick("ctrlcenter:scene", ids.scene, dt.scene, dt.sceneLight),
      font: pick("ctrlcenter:font", ids.font, dt.font, dt.fontLight),
      headingFont: headingFont,
      density: pick("ctrlcenter:density", ids.density, dt.density || "comfortable", dt.densityLight),
      status: status,
      wallpaper: wallpaper,
    };
  }

  return {
    hexToRgb: hexToRgb,
    luminance: luminance,
    relativeLuminance: relativeLuminance,
    contrast: contrast,
    accentInk: accentInk,
    deepenForLight: deepenForLight,
    inkLift: inkLift,
    computePaint: computePaint,
    apply: apply,
    readStored: readStored,
  };
}

// The app's instance — the same code the inline script runs.
export const themePaint = makeThemePaint();

// The no-flash script for app/layout.tsx: the factory's own source, called in
// the browser against localStorage and the serialized site default. Must stay
// a single expression statement so it fits the nonce'd inline <script>; the
// trailing data attribute lets the smoke run assert the script ran rather than
// died in its catch (a serialization slip would otherwise only show as a flash
// of the wrong theme).
export function inlineThemeScript(serializedDefaults: string, ids: PaintIds): string {
  return (
    "(function(){try{" +
    "var t=(" +
    makeThemePaint.toString() +
    ")();" +
    "var el=document.documentElement;" +
    "var dt=" +
    serializedDefaults +
    ";" +
    "var ids=" +
    JSON.stringify(ids) +
    ";" +
    "var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;" +
    "t.apply(el,t.computePaint(t.readStored(window.localStorage,dt,ids,dark)),ids);" +
    "el.setAttribute('data-theme-boot','1');" +
    "}catch(e){}})();"
  );
}
