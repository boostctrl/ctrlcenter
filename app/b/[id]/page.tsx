import type { Metadata } from "next";
import BoardPage from "@/components/BoardPage";
import { readPublicConfig } from "@/lib/api-auth";
import { visibleBoards } from "@/lib/nav";
import { boardName } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The tab title is the board's name, for a board this visitor can open.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { config, isAdmin } = await readPublicConfig();
  const board = visibleBoards(config.boards, isAdmin).find((b) => b.id === id);
  return board ? { title: boardName(board) } : {};
}

// Every board after the first, at /b/<id> (#298).
export default async function Board({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <BoardPage boardId={id} edit={query.edit === "1"} />;
}
