import BoardPage from "@/components/BoardPage";

export const dynamic = "force-dynamic";

// The home page: the first board this visitor can open (#298).
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <BoardPage boardId={null} edit={params.edit === "1"} />;
}
