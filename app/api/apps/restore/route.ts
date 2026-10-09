import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { restoreApp } from "@/lib/config";
import { appRestoreSchema } from "@/lib/schema";

// Undo for a delete (#307): restores the row with its original id and position.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = appRestoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const items = await restoreApp(parsed.data.item, parsed.data.index);
  return NextResponse.json(items);
}
