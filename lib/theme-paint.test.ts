import { describe, it, expect } from "vitest";
import {
  inlineThemeScript,
  makeThemePaint,
  themePaint,
  type PaintDefaults,
  type PaintIds,
} from "./theme-paint";
import { BASE_THEMES, DENSITY_IDS, DESIGN_IDS, SCENE_IDS, THEME_PACKS } from "./theme";
import { FONT_IDS } from "./fonts";
import { serializeForScript } from "./serialize";

const IDS: PaintIds = { design: DESIGN_IDS, scene: SCENE_IDS, font: FONT_IDS, density: DENSITY_IDS };

const DT: PaintDefaults = {
  mode: "system",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

// A localStorage stand-in.
function storage(entries: Record<string, unknown>) {
  const map = new Map(
    Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
  );
  return { getItem: (k: string) => map.get(k) ?? null };
}

// Every built-in look, per mode.
const LOOKS = [...BASE_THEMES, ...THEME_PACKS].flatMap((t) => [
  { name: `${t.name} dark`, dark: true, ...t.dark },
  { name: `${t.name} light`, dark: false, ...t.light },
]);

describe("makeThemePaint is self-contained", () => {
  it("evaluates from its own source with no outer references", () => {
    // The inline no-flash script embeds this source (#325): a reference to
    // anything outside the factory body would throw here, long before it
    // could fail silently inside the browser's try/catch.
    const isolated = new Function(`return (${makeThemePaint.toString()})();`)() as ReturnType<
      typeof makeThemePaint
    >;
    for (const look of LOOKS) {
      const input = {
        dark: look.dark,
        background: look.background,
        foreground: look.foreground,
        accentFrom: look.accentFrom,
        accentTo: look.accentTo,
        design: "cyber",
        scene: "grid",
        font: "inter",
      };
      expect(isolated.computePaint(input)).toEqual(themePaint.computePaint(input));
    const stored = storage({ "ctrlcenter:scene-fx": { dark: { motion: "calm" } }, "ctrlcenter:tune": { dark: { glow: 50 } } });
    expect(isolated.readStored(stored, DT, IDS, true)).toEqual(themePaint.readStored(stored, DT, IDS, true));
    }
  });

  it("builds an inline script that is one statement, escaped for HTML", () => {
    const script = inlineThemeScript(
      serializeForScript({ ...DT, preset: "</script><b>x" }),
      IDS
    );
    expect(script.startsWith("(function(){try{")).toBe(true);
    expect(script.endsWith("}catch(e){}})();")).toBe(true);
    expect(script).not.toContain("</script>");
    expect(script).toContain("data-theme-boot");
  });
});

describe("accentInk (#321)", () => {
  it("picks whichever of black or white contrasts more with the painted stop", () => {
    expect(themePaint.accentInk("#34d399")).toBe("#000000"); // Forest's bright green
    expect(themePaint.accentInk("#a1a1aa")).toBe("#000000"); // Mono's zinc
    expect(themePaint.accentInk("#7c3aed")).toBe("#ffffff"); // a deep violet
    expect(themePaint.accentInk("#a78bfa")).toBe("#000000"); // the default accent
  });

  it("gives every built-in look at least 4.5:1 ink on its accent button", () => {
    const under = LOOKS.filter(
      (l) => themePaint.contrast(themePaint.accentInk(l.accentFrom), l.accentFrom) < 4.5
    ).map((l) => l.name);
    expect(under).toEqual([]);
  });
});

const blend = (bg: string, fg: string, alpha: number) => {
  const a = themePaint.hexToRgb(bg)!;
  const b = themePaint.hexToRgb(fg)!;
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(a[i] * (1 - alpha) + b[i] * alpha).toString(16).padStart(2, "0"))
      .join("")
  );
};

describe("built-in inks", () => {
  it("clear 4.5:1 at full opacity on a 10% card fill, every look, both modes", () => {
    // The lift can't help full-opacity text; the palette itself has to. The
    // smoke run's theme matrix found Everforest light at 4.1:1 this way.
    const under = LOOKS.filter(
      (l) => themePaint.contrast(blend(l.background, l.foreground, 0.1), l.foreground) < 4.5
    ).map((l) => l.name);
    expect(under).toEqual([]);
  });
});

describe("inkLift (#322)", () => {
  // The CSS: text-ink-40 = ink at (100 - 60 * (1 - lift))% opacity, here over
  // the 10% card fill the lift is measured against. Mirror it to check the
  // guarantee the lift is meant to give.
  const ink40 = (bg: string, fg: string, lift: number) => {
    const surface = blend(bg, fg, 0.1);
    const alpha = 1 - 0.6 * (1 - lift);
    return themePaint.contrast(surface, blend(surface, fg, alpha));
  };

  it("never drops below the per-mode floor the stylesheet ships", () => {
    expect(themePaint.inkLift("#06070d", "#f4f4f6", true)).toBeGreaterThanOrEqual(0.15);
    expect(themePaint.inkLift("#eceef3", "#181b24", false)).toBeGreaterThanOrEqual(0.4);
  });

  it("lifts every built-in look's /40 ink to 4.5:1", () => {
    const under = LOOKS.filter((l) => {
      const lift = themePaint.inkLift(l.background, l.foreground, l.dark);
      return ink40(l.background, l.foreground, lift) < 4.5;
    }).map((l) => l.name);
    expect(under).toEqual([]);
  });

  it("raises Everforest light, which the floor left under 3:1", () => {
    const lift = themePaint.inkLift("#f3ead3", "#4a575e", false);
    expect(lift).toBeGreaterThan(0.4);
    expect(ink40("#f3ead3", "#4a575e", 0.4)).toBeLessThan(4.5);
    expect(ink40("#f3ead3", "#4a575e", lift)).toBeGreaterThanOrEqual(4.5);
  });

  it("goes all the way up for a pair that can't reach 4.5:1 at all", () => {
    expect(themePaint.inkLift("#888888", "#999999", true)).toBe(1);
  });
});

describe("computePaint", () => {
  it("removes the surface vars and the lift when no look applies", () => {
    const paint = themePaint.computePaint({
      dark: true,
      background: null,
      foreground: null,
      accentFrom: "#a78bfa",
      accentTo: "#22d3ee",
    });
    expect(paint.vars["--background"]).toBeNull();
    expect(paint.vars["--fg"]).toBeNull();
    expect(paint.vars["--ink-lift"]).toBeNull();
    expect(paint.vars["--accent-from"]).toBe("#a78bfa");
    expect(paint.vars["--accent-fg"]).toBe("#000000");
    // Dark: the scene colors are the raw accent.
    expect(paint.vars["--scene-from"]).toBe("#a78bfa");
    expect(paint.design).toBeUndefined();
  });

  it("deepens the scene colors on light and sets the lift for a look", () => {
    const paint = themePaint.computePaint({
      dark: false,
      background: "#eceef3",
      foreground: "#181b24",
      accentFrom: "#a78bfa",
      accentTo: "#22d3ee",
    });
    expect(paint.vars["--scene-from"]).toBe(`rgb(${themePaint.deepenForLight("#a78bfa")})`);
    expect(paint.vars["--fg"]).toBe("#181b24");
    expect(Number(paint.vars["--ink-lift"])).toBeGreaterThanOrEqual(0.4);
  });
});

describe("computePaint tune (#326)", () => {
  const base = { dark: true, background: null, foreground: null, accentFrom: "#a78bfa", accentTo: "#22d3ee" };

  it("paints each knob as a multiplier, skipping the untouched ones", () => {
    const paint = themePaint.computePaint({
      ...base,
      tune: { radius: 50, border: 200, blur: 100, shadow: 0, fill: 150, glow: 100 },
    });
    expect(paint.vars["--tune-radius"]).toBe("0.5");
    expect(paint.vars["--tune-border"]).toBe("2");
    expect(paint.vars["--tune-blur"]).toBeNull();
    expect(paint.vars["--tune-shadow"]).toBe("0");
    expect(paint.vars["--tune-fill"]).toBe("1.5");
    expect(paint.vars["--tune-glow"]).toBeNull();
  });

  it("removes every multiplier without a tune", () => {
    const paint = themePaint.computePaint({ ...base, tune: null });
    for (const k of ["radius", "border", "blur", "shadow", "fill", "glow"]) {
      expect(paint.vars["--tune-" + k]).toBeNull();
    }
  });
});

describe("computePaint scene effects (#327)", () => {
  const base = { dark: true, background: null, foreground: null, accentFrom: "#a78bfa", accentTo: "#22d3ee" };

  it("paints the intensity and the motion attribute", () => {
    const paint = themePaint.computePaint({ ...base, sceneFx: { intensity: 40, motion: "calm" } });
    expect(paint.vars["--scene-opacity"]).toBe("0.4");
    expect(paint.attrs["data-motion"]).toBe("calm");
  });

  it("leaves both alone when the scene is as designed", () => {
    const paint = themePaint.computePaint({ ...base, sceneFx: null });
    expect(paint.vars["--scene-opacity"]).toBeNull();
    expect(paint.attrs["data-motion"]).toBeNull();
  });

  it("stills everything for the Reduce motion switch, whatever the effects say", () => {
    const paint = themePaint.computePaint({ ...base, sceneFx: { intensity: 100, motion: "normal" }, reduceMotion: true });
    expect(paint.attrs["data-motion"]).toBe("off");
  });
});

describe("typography (#330)", () => {
  const base = { dark: true, background: null, foreground: null, accentFrom: "#a78bfa", accentTo: "#22d3ee" };

  it("paints the density factor and carries the heading font", () => {
    const paint = themePaint.computePaint({ ...base, density: "compact", headingFont: "lora" });
    expect(paint.vars["--density"]).toBe("0.85");
    expect(paint.headingFont).toBe("lora");
    expect(themePaint.computePaint({ ...base, density: "comfortable", headingFont: null }).vars["--density"]).toBeNull();
  });

  it("reads the stored heading and density, with \"body\" overriding the default face", () => {
    const dt: PaintDefaults = { ...DT, headingFont: "playfair", density: "spacious" };
    expect(themePaint.readStored(storage({}), dt, IDS, true)).toMatchObject({ headingFont: "playfair", density: "spacious" });
    const s = storage({ "ctrlcenter:heading": { dark: "body", light: "inter" }, "ctrlcenter:density": { dark: "compact", light: "nope" } });
    expect(themePaint.readStored(s, dt, IDS, true)).toMatchObject({ headingFont: null, density: "compact" });
    expect(themePaint.readStored(s, { ...dt, mode: "light" }, IDS, true)).toMatchObject({ headingFont: "inter", density: "spacious" });
  });
});

describe("semantic colors (#331)", () => {
  const base = { dark: true, background: null, foreground: null, accentFrom: "#a78bfa", accentTo: "#22d3ee" };
  const set = { up: "#00ff00", down: "#ff0000", warning: "#ffaa00", info: "#00aaff" };

  it("paints --status-* from the theme, or removes them", () => {
    const paint = themePaint.computePaint({ ...base, status: set });
    expect(paint.vars["--status-up"]).toBe("#00ff00");
    expect(paint.vars["--status-info"]).toBe("#00aaff");
    const none = themePaint.computePaint({ ...base, status: null });
    expect(none.vars["--status-up"]).toBeNull();
  });

  it("reads the stored set, else the default's, and rejects a partial one", () => {
    expect(themePaint.readStored(storage({ "ctrlcenter:status": { dark: set, light: null } }), DT, IDS, true).status).toEqual(set);
    expect(themePaint.readStored(storage({ "ctrlcenter:status": { dark: { up: "#00ff00" } } }), DT, IDS, true).status).toBeNull();
    expect(themePaint.readStored(storage({}), { ...DT, status: set }, IDS, false).status).toEqual(set);
  });
});

describe("wallpaper (#333)", () => {
  const base = { dark: true, background: null, foreground: null, accentFrom: "#a78bfa", accentTo: "#22d3ee" };
  const wp = { src: "https://example.com/sea.jpg", blur: 8, dim: 40, fit: "contain" };

  it("paints the image, blur, dim and fit vars, or removes them", () => {
    const paint = themePaint.computePaint({ ...base, wallpaper: wp });
    expect(paint.vars["--wallpaper-image"]).toBe('url("https://example.com/sea.jpg")');
    expect(paint.vars["--wallpaper-blur"]).toBe("8px");
    expect(paint.vars["--wallpaper-dim"]).toBe("0.4");
    expect(paint.vars["--wallpaper-size"]).toBe("contain");
    expect(paint.vars["--wallpaper-repeat"]).toBe("no-repeat");
    const tiled = themePaint.computePaint({ ...base, wallpaper: { ...wp, fit: "tile" } });
    expect(tiled.vars["--wallpaper-size"]).toBe("auto");
    expect(tiled.vars["--wallpaper-repeat"]).toBe("repeat");
    const none = themePaint.computePaint({ ...base, wallpaper: null });
    expect(none.vars["--wallpaper-image"]).toBeNull();
    expect(none.vars["--wallpaper-blur"]).toBeNull();
  });

  it("refuses a source that could escape the url(), and clamps blur and dim", () => {
    const bad = themePaint.computePaint({ ...base, wallpaper: { ...wp, src: 'https://x.y/a")b.jpg' } });
    expect(bad.vars["--wallpaper-image"]).toBeNull();
    const js = themePaint.computePaint({ ...base, wallpaper: { ...wp, src: "javascript:alert(1)" } });
    expect(js.vars["--wallpaper-image"]).toBeNull();
    const big = themePaint.computePaint({ ...base, wallpaper: { ...wp, blur: 500, dim: 150 } });
    expect(big.vars["--wallpaper-blur"]).toBe("40px");
    expect(big.vars["--wallpaper-dim"]).toBe("1");
  });

  it("reads the stored per-mode wallpaper, a cleared one over the default, else the default's", () => {
    expect(themePaint.readStored(storage({ "ctrlcenter:wallpaper": { dark: wp, light: null } }), DT, IDS, true).wallpaper).toEqual(wp);
    expect(themePaint.readStored(storage({ "ctrlcenter:wallpaper": { dark: wp, light: null } }), DT, IDS, false).wallpaper).toBeNull();
    const dt = { ...DT, wallpaper: wp };
    expect(themePaint.readStored(storage({}), dt, IDS, false).wallpaper).toEqual(wp);
    expect(themePaint.readStored(storage({ "ctrlcenter:wallpaper": { dark: { src: "" } } }), dt, IDS, true).wallpaper).toBeNull();
    expect(themePaint.readStored(storage({ "ctrlcenter:wallpaper": { dark: { src: "//evil/x.png" } } }), DT, IDS, true).wallpaper).toBeNull();
  });
});

describe("readStored (the no-flash path)", () => {
  it("reads the stored scene effects and the Reduce motion key", () => {
    const s = storage({
      "ctrlcenter:scene-fx": { dark: { intensity: 60, motion: "off" }, light: null },
      "ctrlcenter:motion": "reduce",
    });
    const input = themePaint.readStored(s, DT, IDS, true);
    expect(input.sceneFx).toEqual({ intensity: 60, motion: "off" });
    expect(input.reduceMotion).toBe(true);
    // Light: nothing stored, the default carries a motion only.
    const dt: PaintDefaults = { ...DT, sceneMotion: "calm", sceneIntensityLight: 50 };
    expect(themePaint.readStored(s, { ...dt, mode: "light" }, IDS, true).sceneFx).toEqual({
      intensity: 50,
      motion: "calm",
    });
    expect(themePaint.readStored(storage({}), DT, IDS, true).sceneFx).toBeNull();
    expect(themePaint.readStored(storage({}), DT, IDS, true).reduceMotion).toBe(false);
  });

  it("reads the stored per-mode tune, else the default's, clamped", () => {
    const s = storage({ "ctrlcenter:tune": { dark: { radius: 50, glow: 400 }, light: null } });
    expect(themePaint.readStored(s, DT, IDS, true).tune).toEqual({ radius: 50, glow: 300 });
    const dt: PaintDefaults = { ...DT, tune: { radius: 120 } as never, tuneLight: { blur: 0 } as never };
    expect(themePaint.readStored(s, { ...dt, mode: "light" }, IDS, true).tune).toEqual({ blur: 0 });
    expect(themePaint.readStored(storage({}), dt, IDS, true).tune).toEqual({ radius: 120 });
    expect(themePaint.readStored(storage({}), DT, IDS, true).tune).toBeNull();
  });

  it("falls back to the site default with nothing stored", () => {
    const input = themePaint.readStored(storage({}), DT, IDS, true);
    expect(input).toEqual({
      dark: true,
      background: null,
      foreground: null,
      accentFrom: "#a78bfa",
      accentTo: "#22d3ee",
      tune: null,
      sceneFx: null,
      reduceMotion: false,
      design: "glass",
      scene: "aurora",
      font: "jakarta",
      headingFont: null,
      density: "comfortable",
      status: null,
      wallpaper: null,
    });
  });

  it("follows the stored mode, and the OS for system", () => {
    expect(themePaint.readStored(storage({ "ctrlcenter:theme": "light" }), DT, IDS, true).dark).toBe(false);
    expect(themePaint.readStored(storage({ "ctrlcenter:theme": "dark" }), DT, IDS, false).dark).toBe(true);
    expect(themePaint.readStored(storage({}), { ...DT, mode: "light" }, IDS, true).dark).toBe(false);
    expect(themePaint.readStored(storage({}), DT, IDS, false).dark).toBe(false);
  });

  it("uses the active look's variant for the mode, with its own accent", () => {
    const look = { dark: THEME_PACKS[1].dark, light: THEME_PACKS[1].light };
    const input = themePaint.readStored(
      storage({ "ctrlcenter:activeTheme": look, "ctrlcenter:theme": "light" }),
      DT,
      IDS,
      true
    );
    expect(input.background).toBe(look.light.background);
    expect(input.accentFrom).toBe(look.light.accentFrom);
  });

  it("reads a flat pre-mode look as both modes", () => {
    const flat = THEME_PACKS[2].dark;
    const input = themePaint.readStored(
      storage({ "ctrlcenter:activeTheme": flat, "ctrlcenter:theme": "light" }),
      DT,
      IDS,
      true
    );
    expect(input.background).toBe(flat.background);
  });

  it("seeds the admin custom default colors when the visitor has none", () => {
    const dt: PaintDefaults = {
      ...DT,
      background: "#000000",
      foreground: "#ffffff",
      backgroundLight: "#ffffff",
      foregroundLight: "#000000",
      accentFromLight: "#111111",
      accentToLight: "#222222",
    };
    expect(themePaint.readStored(storage({}), dt, IDS, true)).toMatchObject({
      background: "#000000",
      accentFrom: "#a78bfa",
    });
    expect(themePaint.readStored(storage({}), dt, IDS, false)).toMatchObject({
      background: "#ffffff",
      accentFrom: "#111111",
    });
  });

  it("layers a per-mode accent override, and a flat one for both modes", () => {
    const perMode = { dark: { from: "#111111", to: "#222222" }, light: null };
    expect(
      themePaint.readStored(storage({ "ctrlcenter:accent": perMode }), DT, IDS, true).accentFrom
    ).toBe("#111111");
    expect(
      themePaint.readStored(storage({ "ctrlcenter:accent": perMode, "ctrlcenter:theme": "light" }), DT, IDS, true)
        .accentFrom
    ).toBe("#a78bfa");
    const flat = { from: "#333333", to: "#444444" };
    expect(
      themePaint.readStored(storage({ "ctrlcenter:accent": flat, "ctrlcenter:theme": "light" }), DT, IDS, true)
        .accentTo
    ).toBe("#444444");
  });

  it("picks the stored per-mode design/scene/font, validated, else the mode's default", () => {
    const dt: PaintDefaults = { ...DT, design: "bold", designLight: "paper", scene: "grid" };
    const s = storage({
      "ctrlcenter:design": { dark: "cyber", light: "nope" },
      "ctrlcenter:font": { dark: null, light: "inter" },
    });
    expect(themePaint.readStored(s, dt, IDS, true)).toMatchObject({
      design: "cyber",
      scene: "grid",
      font: "jakarta",
    });
    expect(themePaint.readStored(s, { ...dt, mode: "light" }, IDS, true)).toMatchObject({
      design: "paper", // "nope" is not a design this build knows
      scene: "grid", // no sceneLight: the dark default
      font: "inter",
    });
  });

  it("ignores unparsable storage", () => {
    const s = storage({ "ctrlcenter:activeTheme": "{not json", "ctrlcenter:design": "[1" });
    expect(themePaint.readStored(s, DT, IDS, true).background).toBeNull();
    expect(themePaint.readStored(s, DT, IDS, true).design).toBe("glass");
  });
});
