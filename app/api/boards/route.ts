import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { replaceBoards } from "@/lib/config";
import { boardsUpdateSchema } from "@/lib/schema";

// Admin-only: replace the board list (#298) — names, order and visibility,
// as admin Settings → Layout edits and autosaves them whole. A board sent
// without a layout keeps its stored arrangement.
export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = boardsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid boards" },
      { status: 400 }
    );
  }
  return NextResponse.json(await replaceBoards(parsed.data));
}
