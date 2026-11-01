import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, replaceBoards } from "@/lib/config";
import { boardsPatchSchema, boardsUpdateSchema } from "@/lib/schema";
import { applyListPatch } from "@/lib/list-patch";

// Admin-only: the board list (#298) — names, order and visibility. Settings →
// Layout and the editor's board menu send what they changed since their last
// save (#396: upsert / remove / order, applied to the stored list, so a
// rename in one tab can't delete a board another tab created or send its
// visibility back as it was at page load); a plain array replaces the list
// whole. A board sent without a layout keeps its stored arrangement, and one
// the patch doesn't name keeps its icon and theme too.
export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  let list: unknown = body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const patch = boardsPatchSchema.safeParse(body);
    if (!patch.success) {
      return NextResponse.json({ error: patch.error.issues[0]?.message ?? "Invalid boards" }, { status: 400 });
    }
    // The stored boards as update items that change nothing: icon, theme and
    // layout left out, which replaceBoards reads as "keep".
    const { boards } = await readConfigInternal();
    list = applyListPatch(
      boards.map(({ id, name, visibility }) => ({ id, name, visibility })),
      patch.data
    );
  }
  const parsed = boardsUpdateSchema.safeParse(list);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid boards" },
      { status: 400 }
    );
  }
  return NextResponse.json(await replaceBoards(parsed.data));
}
