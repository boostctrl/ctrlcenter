import { NextRequest, NextResponse } from "next/server";
import { updateBookmark, deleteBookmark } from "@/lib/config";
import { bookmarkUpdateSchema } from "@/lib/schema";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bookmarkUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const bookmark = await updateBookmark(id, parsed.data);
    return NextResponse.json(bookmark);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteBookmark(id);
  return NextResponse.json({ ok: true });
}
