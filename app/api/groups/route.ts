import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { GroupInUseError, listGroups, replaceGroups } from "@/lib/config";
import { groupsUpdateSchema } from "@/lib/schema";

// Admin-only: the groups apps and bookmarks belong to (#299). GET lists them
// (an item form can create one, so the managers refresh from here); PUT
// replaces the list — renames, reorders, merges (two groups given one name)
// and deletes (only of an unused group), answering with the groups and the
// items a merge moved.
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await listGroups());
}

export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = groupsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid groups" },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(await replaceGroups(parsed.data));
  } catch (e) {
    if (e instanceof GroupInUseError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
