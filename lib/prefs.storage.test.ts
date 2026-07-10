import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDesign,
  saveDesign,
  loadScene,
  saveScene,
  loadFont,
  saveFont,
  loadThemes,
  saveThemes,
  sanitizeCustomTheme,
  parseThemesExport,
  newThemeId,
  loadFavorites,
  saveFavorites,
  loadAccentOverride,
  saveAccentOverride,
  THEMES_KEY,
  DESIGN_KEY,
  FAVORITES_KEY,
  ACCENT_KEY,
  type CustomTheme,
} from "@/lib/prefs";

// Minimal localStorage stub so the window-gated load/save helpers run under the
// node test environment.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  raw(k: string): string | null {
    return this.getItem(k);
  }
}

let store: MemStore;

beforeEach(() => {
  store = new MemStore();
  (globalThis as unknown as { window: unknown }).window = { localStorage: store };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("per-mode design/scene/font storage", () => {
  it("round-trips an independent dark/light pair", () => {
    saveDesign({ dark: "flat", light: "paper" });
    expect(loadDesign()).toEqual({ dark: "flat", light: "paper" });

    saveScene({ dark: "grid", light: "waves" });
    expect(loadScene()).toEqual({ dark: "grid", light: "waves" });

    saveFont({ dark: "jetbrains", light: "lora" });
    expect(loadFont()).toEqual({ dark: "jetbrains", light: "lora" });
  });

  it("reads a legacy bare-string value as both modes", () => {
    // Saved before modes were independent: a single unquoted id.
    store.setItem(DESIGN_KEY, "bold");
    expect(loadDesign()).toEqual({ dark: "bold", light: "bold" });
  });

  it("drops invalid ids per mode", () => {
    store.setItem(DESIGN_KEY, JSON.stringify({ dark: "nope", light: "cyber" }));
    expect(loadDesign()).toEqual({ dark: null, light: "cyber" });
  });

  it("saving null clears the key", () => {
    saveDesign({ dark: "flat", light: "paper" });
    saveDesign(null);
    expect(store.raw(DESIGN_KEY)).toBeNull();
    expect(loadDesign()).toEqual({ dark: null, light: null });
  });

  it("saving an all-null pair clears the key", () => {
    saveDesign({ dark: null, light: null });
    expect(store.raw(DESIGN_KEY)).toBeNull();
  });
});

describe("accent override storage", () => {
  const violet = { from: "#a78bfa", to: "#22d3ee" };
  const rose = { from: "#e11d48", to: "#db2777" };

  it("round-trips independent per-mode overrides", () => {
    saveAccentOverride({ dark: violet, light: rose });
    expect(loadAccentOverride()).toEqual({ dark: violet, light: rose });
  });

  it("keeps a one-sided override with the other mode null", () => {
    saveAccentOverride({ dark: violet, light: null });
    expect(loadAccentOverride()).toEqual({ dark: violet, light: null });
  });

  it("reads a legacy flat {from,to} as an override for both modes", () => {
    // Saved before accents were per-mode.
    store.setItem(ACCENT_KEY, JSON.stringify(violet));
    expect(loadAccentOverride()).toEqual({ dark: violet, light: violet });
  });

  it("drops malformed colors per mode and junk entirely", () => {
    store.setItem(
      ACCENT_KEY,
      JSON.stringify({ dark: { from: "red", to: "#22d3ee" }, light: rose })
    );
    expect(loadAccentOverride()).toEqual({ dark: null, light: rose });
    store.setItem(ACCENT_KEY, JSON.stringify(["nope"]));
    expect(loadAccentOverride()).toEqual({ dark: null, light: null });
  });

  it("saving null or an all-null pair clears the key", () => {
    saveAccentOverride({ dark: violet, light: rose });
    saveAccentOverride(null);
    expect(store.raw(ACCENT_KEY)).toBeNull();
    saveAccentOverride({ dark: violet, light: rose });
    saveAccentOverride({ dark: null, light: null });
    expect(store.raw(ACCENT_KEY)).toBeNull();
  });
});

describe("favorites storage", () => {
  it("round-trips the pinned id list in order", () => {
    saveFavorites(["b", "a", "c"]);
    expect(loadFavorites()).toEqual(["b", "a", "c"]);
  });

  it("returns an empty list when unset", () => {
    expect(loadFavorites()).toEqual([]);
  });

  it("ignores non-array or non-string junk", () => {
    store.setItem(FAVORITES_KEY, JSON.stringify({ not: "an array" }));
    expect(loadFavorites()).toEqual([]);
    store.setItem(FAVORITES_KEY, JSON.stringify(["ok", 5, null, "two"]));
    expect(loadFavorites()).toEqual(["ok", "two"]);
  });
});

describe("loadThemes migration", () => {
  it("fills light-mode parts from the dark parts for a pre-independent theme", () => {
    const legacy = {
      id: "t1",
      name: "Old",
      design: "cyber",
      scene: "grid",
      // No font / *Light fields, colors as a flat single set (pre mode-aware).
      background: "#101010",
      foreground: "#fafafa",
      accentFrom: "#ff00ff",
      accentTo: "#00ffff",
    };
    store.setItem(THEMES_KEY, JSON.stringify([legacy]));
    const [t] = loadThemes();
    expect(t.design).toBe("cyber");
    expect(t.designLight).toBe("cyber");
    expect(t.scene).toBe("grid");
    expect(t.sceneLight).toBe("grid");
    // Font absent → defaults, both modes.
    expect(t.font).toBe("jakarta");
    expect(t.fontLight).toBe("jakarta");
    // Flat colors wrapped into both modes.
    expect(t.dark.background).toBe("#101010");
    expect(t.light.background).toBe("#101010");
  });

  it("preserves independent light-mode parts when present", () => {
    const modern = {
      id: "t2",
      name: "New",
      design: "flat",
      scene: "dots",
      font: "inter",
      designLight: "paper",
      sceneLight: "waves",
      fontLight: "lora",
      dark: {
        background: "#000000",
        foreground: "#ffffff",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
      },
      light: {
        background: "#ffffff",
        foreground: "#000000",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
      },
    };
    store.setItem(THEMES_KEY, JSON.stringify([modern]));
    const [t] = loadThemes();
    expect(t.design).toBe("flat");
    expect(t.designLight).toBe("paper");
    expect(t.sceneLight).toBe("waves");
    expect(t.fontLight).toBe("lora");
    expect(t.light.background).toBe("#ffffff");
  });
});

describe("newThemeId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints unique ids", () => {
    expect(newThemeId()).not.toBe(newThemeId());
  });

  it("works without crypto.randomUUID (plain-HTTP insecure context)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => real.getRandomValues(arr),
    });
    const id = newThemeId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(newThemeId()).not.toBe(id);
  });
});

describe("saveThemes", () => {
  const theme: CustomTheme = {
    id: "t1",
    name: "Mine",
    design: "flat",
    scene: "dots",
    font: "inter",
    designLight: "paper",
    sceneLight: "waves",
    fontLight: "lora",
    dark: {
      background: "#000000",
      foreground: "#ffffff",
      accentFrom: "#a78bfa",
      accentTo: "#22d3ee",
    },
    light: {
      background: "#ffffff",
      foreground: "#000000",
      accentFrom: "#a78bfa",
      accentTo: "#22d3ee",
    },
  };

  it("reports success when the write lands", () => {
    expect(saveThemes([theme])).toBe(true);
    expect(loadThemes()).toHaveLength(1);
  });

  it("reports failure when storage rejects the write", () => {
    store.setItem = () => {
      throw new Error("quota");
    };
    expect(saveThemes([theme])).toBe(false);
  });
});

// A complete, current-shape saved theme, shared by the sanitize/parse suites.
const validEntry: CustomTheme = {
  id: "abc",
  name: "Mine",
  design: "flat",
  scene: "dots",
  font: "inter",
  designLight: "paper",
  sceneLight: "waves",
  fontLight: "lora",
  dark: {
    background: "#000000",
    foreground: "#ffffff",
    accentFrom: "#a78bfa",
    accentTo: "#22d3ee",
  },
  light: {
    background: "#ffffff",
    foreground: "#000000",
    accentFrom: "#a78bfa",
    accentTo: "#22d3ee",
  },
};

describe("sanitizeCustomTheme", () => {
  it("round-trips a valid entry unchanged", () => {
    expect(sanitizeCustomTheme(validEntry)).toEqual(validEntry);
  });

  it("rejects an entry with malformed colors", () => {
    expect(
      sanitizeCustomTheme({
        ...validEntry,
        dark: { ...validEntry.dark, background: "red" },
      })
    ).toBeNull();
    expect(sanitizeCustomTheme({ name: "no colors" })).toBeNull();
  });

  it("mints an id when the id isn't a string", () => {
    const out = sanitizeCustomTheme({ ...validEntry, id: 42 });
    expect(typeof out?.id).toBe("string");
    expect(out?.id).not.toBe("42");
    // Everything else survives the mint.
    expect(out?.name).toBe("Mine");
  });

  it("slices an over-long name to 40 characters", () => {
    const out = sanitizeCustomTheme({ ...validEntry, name: "x".repeat(60) });
    expect(out?.name).toHaveLength(40);
  });
});

describe("parseThemesExport", () => {
  it("accepts a bare array of themes", () => {
    const out = parseThemesExport([validEntry]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Mine");
  });

  it("accepts a single theme object", () => {
    expect(parseThemesExport(validEntry)).toHaveLength(1);
  });

  it("accepts a { themes: [...] } wrapper", () => {
    expect(parseThemesExport({ themes: [validEntry, validEntry] })).toHaveLength(2);
  });

  it("returns [] for empty wrappers, garbage, and non-objects", () => {
    expect(parseThemesExport({ themes: [] })).toEqual([]);
    expect(parseThemesExport("nope")).toEqual([]);
    expect(parseThemesExport(null)).toEqual([]);
    expect(parseThemesExport(42)).toEqual([]);
  });

  it("drops invalid entries but keeps the valid ones", () => {
    const out = parseThemesExport([validEntry, { name: "no colors" }]);
    expect(out).toHaveLength(1);
  });

  it("re-mints every id, so an import can't collide with the saved list", () => {
    const [one] = parseThemesExport([validEntry]);
    expect(one.id).not.toBe(validEntry.id);
    const [a, b] = parseThemesExport([validEntry, validEntry]);
    expect(a.id).not.toBe(b.id);
  });
});
