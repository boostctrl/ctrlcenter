// Boards (#298): the admin edits the list (names, order, visibility) as a
// whole; the layout editor saves one board's arrangement.
import type { z } from "zod";
import type { Board, BoardsUpdate, boardLayoutUpdateSchema } from "../schema";
import { GRID_COLUMNS } from "../layout";
import { mutate } from "./store";

// Replace the board list. A board sent without a layout keeps the one stored
// under its id, and a new board starts empty.
export async function replaceBoards(input: BoardsUpdate): Promise<Board[]> {
  return mutate((config) => {
    const stored = new Map(config.boards.map((b) => [b.id, b]));
    config.boards = input.map(({ layout, ...meta }) => ({
      ...meta,
      layout: layout
        ? { columns: GRID_COLUMNS, sections: layout.sections }
        : (stored.get(meta.id)?.layout ?? { columns: GRID_COLUMNS, sections: [] }),
    }));
    return config.boards;
  });
}

export class UnknownBoardError extends Error {}

// Save one board's arrangement, plus the page-level values the editor tunes
// alongside it (scale and spacing are site-wide, in settings.layout).
export async function updateBoardLayout(
  id: string,
  { sections, ...page }: z.infer<typeof boardLayoutUpdateSchema>
): Promise<void> {
  await mutate((config) => {
    const board = config.boards.find((b) => b.id === id);
    if (!board) throw new UnknownBoardError(id);
    board.layout = { columns: GRID_COLUMNS, sections };
    config.settings.layout = { ...config.settings.layout, ...page };
  });
}
