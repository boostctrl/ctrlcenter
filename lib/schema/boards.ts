// Boards (#298, 3.0): several dashboards, each with its own arrangement and
// visibility. The first board is the home page at `/`; the others live at
// `/b/<id>`. Widget instances are shared: a board's rows place instances from
// the top-level `widgets` list by id, so one notes card can sit on two boards.
import { z } from "zod";
import { DEFAULT_SECTIONS } from "../layout";
import { boardLayoutSchema, layoutRowInputSchema, MAX_BOARD_ROWS } from "./layout";

// Board ids are the URL slug (/b/<id>), so the same rules as instance ids.
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const boardId = z.string().min(1).max(64).regex(BOARD_ID_PATTERN);

export const MAX_BOARDS = 20;
export const MAX_BOARD_NAME = 60;

// Who can open a board: everyone, or only the signed-in admin. A private
// board is a 404 for everyone else, and never appears in their navigation.
// An enum rather than a flag so 3.1 can add group rules (#284).
export const BOARD_VISIBILITIES = ["public", "private"] as const;
export const boardVisibilitySchema = z.enum(BOARD_VISIBILITIES);
export type BoardVisibility = z.infer<typeof boardVisibilitySchema>;

export const boardSchema = z.object({
  id: boardId,
  name: z.string().max(MAX_BOARD_NAME).catch("").default(""),
  visibility: boardVisibilitySchema.catch("public").default("public"),
  layout: boardLayoutSchema.default(boardLayoutSchema.parse({})),
});
export type Board = z.infer<typeof boardSchema>;

// A fresh config's single board: the stock arrangement, public.
export const HOME_BOARD_ID = "home";
export const DEFAULT_BOARDS: Board[] = [
  boardSchema.parse({
    id: HOME_BOARD_ID,
    name: "Home",
    layout: { sections: DEFAULT_SECTIONS },
  }),
];

// Stored leniently: a board that won't parse is dropped, a repeated id keeps
// its first board, and a list left empty falls back to the stock board, so
// there is always a home page.
export const boardsSchema = z
  .array(z.unknown())
  .catch([])
  .default(DEFAULT_BOARDS)
  .transform((rows): Board[] => {
    const seen = new Set<string>();
    const out: Board[] = [];
    for (const row of rows) {
      const parsed = boardSchema.safeParse(row);
      if (!parsed.success || seen.has(parsed.data.id)) continue;
      seen.add(parsed.data.id);
      out.push(parsed.data);
    }
    return out.length > 0 ? out.slice(0, MAX_BOARDS) : DEFAULT_BOARDS;
  });

// The board's display name: its own, else its id.
export const boardName = (board: Pick<Board, "id" | "name">): string =>
  board.name.trim() || board.id;

// A new board's id (its URL, /b/<id>): the name made URL-safe, kept unique.
export function newBoardId(name: string, taken: readonly string[]): string {
  const stem =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "board";
  let id = stem;
  for (let n = 2; taken.includes(id); n++) id = `${stem}-${n}`;
  return id;
}

// Admin input (PUT /api/boards): the whole list, in order. A board sent
// without `layout` keeps its stored rows (a new one starts empty), so this
// form can't overwrite an arrangement the editor saved meanwhile.
export const boardsUpdateSchema = z
  .array(
    z.object({
      id: boardId,
      name: z.string().max(MAX_BOARD_NAME),
      visibility: boardVisibilitySchema,
      layout: z.object({ sections: z.array(layoutRowInputSchema).max(MAX_BOARD_ROWS) }).optional(),
    })
  )
  .min(1)
  .max(MAX_BOARDS)
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    list.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: "custom", message: "Duplicate board id", path: [i, "id"] });
      ids.add(b.id);
    });
  });
export type BoardsUpdate = z.infer<typeof boardsUpdateSchema>;
