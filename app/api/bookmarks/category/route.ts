import { NextRequest, NextResponse } from "next/server";
import { renameBookmarkCategory } from "@/lib/config";
import { bookmarkCategoryRenameSchema } from "@/lib/schema";

// Rename a whole bookmark category across its bookmarks. The `/api/bookmarks`
// prefix is already admin-gated by the proxy, and Next resolves this static
// `category` segment ahead of the sibling `[id]` dynamic route (ids are UUIDs,
// so there's no collision).
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bookmarkCategoryRenameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await renameBookmarkCategory(parsed.data.from, parsed.data.to);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
