import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { replaceWidgets } from "@/lib/config";
import { widgetInstancesUpdateSchema } from "@/lib/schema";

// Admin-only: replace the widget instances (#297) — the list the admin
// Settings → Widgets tab edits and autosaves whole.
export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = widgetInstancesUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid widgets" },
      { status: 400 }
    );
  }
  return NextResponse.json(await replaceWidgets(parsed.data));
}
