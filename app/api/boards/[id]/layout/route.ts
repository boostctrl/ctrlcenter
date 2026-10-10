import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { UnknownBoardError, updateBoardLayout } from "@/lib/config";
import { boardLayoutUpdateSchema } from "@/lib/schema";

// Admin-only: the layout editor's autosave for one board (#298) — its rows,
// plus the site-wide scale and spacing its toolbar tunes.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = boardLayoutUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid layout" },
      { status: 400 }
    );
  }
  try {
    await updateBoardLayout(id, parsed.data);
  } catch (e) {
    if (e instanceof UnknownBoardError) {
      return NextResponse.json({ error: "No such board" }, { status: 404 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
