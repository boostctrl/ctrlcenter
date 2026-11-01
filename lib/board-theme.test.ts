import { describe, it, expect } from "vitest";
import { boardDefaultTheme, boardForPath } from "./board-theme";
import { THEME_PACKS, resolveThemeGallery } from "./theme";
import { settingsSchema } from "./schema";
import { ADMIN_VIEW } from "./visibility";

const boards = [
  { id: "home", visibility: "public" as const, theme: undefined },
  { id: "infra", visibility: "public" as const, theme: "Circuit" },
  { id: "secret", visibility: "private" as const, theme: "Nope" },
];

describe("boardForPath (#337)", () => {
  it("finds the home board at / and a board at /b/<id>, for who may open it", () => {
    expect(boardForPath("/", boards, null)?.id).toBe("home");
    expect(boardForPath("/b/infra", boards, null)?.id).toBe("infra");
    expect(boardForPath("/b/infra/", boards, null)?.id).toBe("infra");
    expect(boardForPath("/b/secret", boards, null)).toBeNull();
    expect(boardForPath("/b/secret", boards, ADMIN_VIEW)?.id).toBe("secret");
    expect(boardForPath("/b/home", boards, null)?.id).toBe("home");
  });

  it("is null for any other page or an unknown board", () => {
    for (const p of ["/settings", "/b/", "/b/x/y", "/b/missing", "/weather", "", null, undefined]) {
      expect(boardForPath(p, boards, ADMIN_VIEW)).toBeNull();
    }
    // A private first board: a guest's home is the next public one.
    const privateFirst = [{ id: "a", visibility: "private" as const }, { id: "b", visibility: "public" as const }];
    expect(boardForPath("/", privateFirst, null)?.id).toBe("b");
    expect(boardForPath("/", privateFirst, ADMIN_VIEW)?.id).toBe("a");
  });
});

describe("boardDefaultTheme (#337)", () => {
  const theme = settingsSchema.parse({}).theme;

  it("lays the board's pack over the site theme, or leaves it be", () => {
    const circuit = THEME_PACKS.find((p) => p.name === "Circuit")!;
    const t = boardDefaultTheme(theme, boards[1], THEME_PACKS);
    expect(t.design).toBe(circuit.design);
    expect(t.preset).toBe("Circuit");
    expect(t.mode).toBe(theme.mode);
    expect(boardDefaultTheme(theme, boards[0], THEME_PACKS)).toBe(theme);
    expect(boardDefaultTheme(theme, null, THEME_PACKS)).toBe(theme);
    // A pack that's gone (deleted): the site theme.
    expect(boardDefaultTheme(theme, boards[2], THEME_PACKS)).toBe(theme);
  });

  it("pins by the pack's key, so a rename keeps the pin; a pin by name still resolves (#395)", () => {
    const colors = {
      dark: { background: "#000000", foreground: "#ffffff", accentFrom: "#ff0000", accentTo: "#00ff00" },
      light: { background: "#ffffff", foreground: "#000000", accentFrom: "#ff0000", accentTo: "#00ff00" },
    };
    const gallery = resolveThemeGallery([
      { key: "Circuit", builtin: "Circuit", name: "Wires" },
      { key: "custom-ab12cd34", name: "Mine", design: "paper", ...colors },
    ]).map((r) => r.pack);
    // The built-in renamed: the pin (its key, the shipped name) holds.
    expect(boardDefaultTheme(theme, { theme: "Circuit" }, gallery).preset).toBe("Wires");
    // A pack of the admin's own by key, and by its name from an older config.
    expect(boardDefaultTheme(theme, { theme: "custom-ab12cd34" }, gallery).design).toBe("paper");
    expect(boardDefaultTheme(theme, { theme: "Mine" }, gallery).design).toBe("paper");
  });
});
