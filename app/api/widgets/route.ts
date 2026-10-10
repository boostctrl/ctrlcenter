import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { z } from "zod";
import { InvalidWidgetsError, addWidget, replaceWidgets } from "@/lib/config";
import { WIDGET_IDS } from "@/lib/widgets/defs";
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

// Admin-only: add one widget of a type, with its defaults and a fresh id —
// the layout editor's palette (#303). Answers with the new instance; placing
// it on a board is the editor's own layout save.
const addSchema = z.object({ type: z.enum(WIDGET_IDS as unknown as [string, ...string[]]) });

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown widget type" }, { status: 400 });
  try {
    return NextResponse.json(await addWidget(parsed.data.type as Parameters<typeof addWidget>[0]), { status: 201 });
  } catch (e) {
    if (e instanceof InvalidWidgetsError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
