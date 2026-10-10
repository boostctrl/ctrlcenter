// A board's own theme (#337): a gallery pack pinned on top of the site
// default, so an Infra board can be Circuit while the home board stays as
// it is. Pure, shared by the root layout (the first paint, from the request
// path), the board page (the live default while the board is open) and the
// admin editors.
import type { Board } from "./schema";
import type { ThemePack } from "./theme";
import { pickBoard } from "./nav";
import { themeWithPack } from "./theme-schedule";

// The board a request path shows, if it is a board page: `/` is the first
// board this visitor can open, `/b/<id>` that board. Anything else (another
// page, a board they can't open) is null.
export function boardForPath<B extends Pick<Board, "id" | "visibility">>(
  pathname: string | null | undefined,
  boards: readonly B[],
  isAdmin: boolean
): B | null {
  if (!pathname) return null;
  let id: string | null;
  if (pathname === "/") id = null;
  else {
    const m = /^\/b\/([^/]+)\/?$/.exec(pathname);
    if (!m) return null;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  const pick = pickBoard(boards, id, isAdmin);
  if (pick.kind === "board") return pick.board;
  // /b/<home id> redirects to /, so it shows the home board.
  if (pick.kind === "home") {
    const home = pickBoard(boards, null, isAdmin);
    return home.kind === "board" ? home.board : null;
  }
  return null;
}

// The site theme with the board's pinned pack applied, or the site theme
// itself when the board pins none (or names a pack that no longer exists).
export function boardDefaultTheme<
  T extends {
    mode: "system" | "light" | "dark";
    design: string;
    scene: string;
    font: string;
    accentFrom: string;
    accentTo: string;
  },
>(theme: T, board: Pick<Board, "theme"> | null, gallery: readonly ThemePack[]): T {
  if (!board?.theme) return theme;
  const pack = gallery.find((p) => p.name === board.theme);
  return pack ? themeWithPack(theme, pack) : theme;
}
