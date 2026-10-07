import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { renameBookmarkCategory } from "@/lib/config";
import { itemMutationErrorResponse } from "@/lib/api-errors";
import { bookmarkCategoryRenameSchema } from "@/lib/schema";

// Rename a whole bookmark category across its bookmarks. Admin-only (the
// `/api/bookmarks` proxy prefix plus the session re-check below). Next resolves
// this static `category` segment ahead of the sibling `[id]` dynamic route (ids
// are UUIDs, so there's no collision).
export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bookmarkCategoryRenameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await renameBookmarkCategory(parsed.data.from, parsed.data.to);
    return NextResponse.json(result);
  } catch (error) {
    return itemMutationErrorResponse(error);
  }
}
