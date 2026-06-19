import { NextRequest, NextResponse } from "next/server";
import { listBookmarks, createBookmark, reorderBookmarks } from "@/lib/config";
import { bookmarkInputSchema, reorderSchema } from "@/lib/schema";

export async function GET() {
  const bookmarks = await listBookmarks();
  return NextResponse.json(bookmarks);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bookmarkInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const bookmark = await createBookmark(parsed.data);
  return NextResponse.json(bookmark, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const bookmarks = await reorderBookmarks(parsed.data.ids);
  return NextResponse.json(bookmarks);
}
