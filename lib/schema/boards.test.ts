import { describe, it, expect } from "vitest";
import { boardsSchema, boardsUpdateSchema, boardName, newBoardId, DEFAULT_BOARDS, MAX_BOARDS } from "../schema";

// Boards (#298): the stored list is lenient, admin input strict.

describe("boardsSchema", () => {
  it("fills a board's defaults: a public, empty board named by its id", () => {
    const [b] = boardsSchema.parse([{ id: "media" }]);
    expect(b).toEqual({ id: "media", name: "", visibility: "public", layout: { columns: 24, sections: [] } });
    expect(boardName(b)).toBe("media");
    expect(boardName({ ...b, name: "  Media  " })).toBe("Media");
  });

  it("drops a board that won't parse and a repeated id, keeping the first", () => {
    const out = boardsSchema.parse([
      { id: "a", name: "First" },
      { id: "has space" },
      "garbage",
      { id: "a", name: "Second" },
      { id: "b", visibility: "secret" },
    ]);
    expect(out.map((b) => [b.id, b.name])).toEqual([
      ["a", "First"],
      ["b", ""],
    ]);
    // A bad visibility falls back to public rather than dropping the board.
    expect(out[1].visibility).toBe("public");
  });

  it("falls back to the stock home board when nothing usable is left", () => {
    expect(boardsSchema.parse([])).toEqual(DEFAULT_BOARDS);
    expect(boardsSchema.parse("nope")).toEqual(DEFAULT_BOARDS);
    expect(boardsSchema.parse(undefined)).toEqual(DEFAULT_BOARDS);
  });

  it("keeps at most MAX_BOARDS", () => {
    const many = Array.from({ length: MAX_BOARDS + 5 }, (_, i) => ({ id: `b${i}` }));
    expect(boardsSchema.parse(many)).toHaveLength(MAX_BOARDS);
  });

  it("re-parses its own output unchanged (writeConfig re-parses on save)", () => {
    const once = boardsSchema.parse([{ id: "x", name: "X", layout: { sections: [{ widget: "apps", span: 6 }] } }]);
    expect(boardsSchema.parse(once)).toEqual(once);
  });
});

describe("boardsUpdateSchema", () => {
  const board = { id: "home", name: "Home", visibility: "public" as const };

  it("takes boards with or without rows", () => {
    const parsed = boardsUpdateSchema.parse([
      board,
      { id: "infra", name: "Infra", visibility: "private", layout: { sections: [{ widget: "notes", span: 8 }] } },
    ]);
    expect(parsed[0]).not.toHaveProperty("layout");
    expect(parsed[1].layout?.sections).toEqual([{ widget: "notes", span: 8 }]);
  });

  it("rejects an empty list, a repeated id, a bad id, visibility or row", () => {
    for (const bad of [
      [],
      [board, board],
      [{ ...board, id: "a/b" }],
      [{ ...board, visibility: "secret" }],
      [{ ...board, name: "x".repeat(61) }],
      [{ ...board, layout: { sections: [{ widget: "apps", span: 25 }] } }],
      Array.from({ length: MAX_BOARDS + 1 }, (_, i) => ({ ...board, id: `b${i}` })),
    ]) {
      expect(boardsUpdateSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("newBoardId", () => {
  it("makes the name URL-safe", () => {
    expect(newBoardId("Media & TV", [])).toBe("media-tv");
    expect(newBoardId("Café", [])).toBe("cafe");
    expect(newBoardId("  ", [])).toBe("board");
    expect(newBoardId("日本", [])).toBe("board");
  });

  it("keeps it unique", () => {
    expect(newBoardId("Media", ["media"])).toBe("media-2");
    expect(newBoardId("Media", ["media", "media-2"])).toBe("media-3");
  });
});
