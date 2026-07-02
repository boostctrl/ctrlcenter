import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadDesign,
  saveDesign,
  loadScene,
  saveScene,
  loadFont,
  saveFont,
  loadThemes,
  loadFavorites,
  saveFavorites,
  loadAccentOverride,
  saveAccentOverride,
  THEMES_KEY,
  DESIGN_KEY,
  FAVORITES_KEY,
  ACCENT_KEY,
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
