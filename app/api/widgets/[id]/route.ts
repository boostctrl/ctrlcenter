import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { InvalidWidgetsError, saveWidget, widgetForEditing } from "@/lib/config";
import { widgetInstanceUpdateSchema, type WidgetInstance } from "@/lib/schema";

// Admin-only: one widget instance, edited in place from the layout editor
// (#303). GET answers with the instance as stored (secrets included) and what
// its editor offers to pick from; PUT saves it, or adds it when the id is
// new, leaving every other instance untouched.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const context = await widgetForEditing((await params).id);
  if (!context) return NextResponse.json({ error: "No such widget" }, { status: 404 });
  return NextResponse.json(context);
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = widgetInstanceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid widget" }, { status: 400 });
  }
  if (parsed.data.id !== id) {
    return NextResponse.json({ error: "The widget id doesn't match the address" }, { status: 400 });
  }
  try {
    return NextResponse.json(await saveWidget(parsed.data as WidgetInstance));
  } catch (e) {
    if (e instanceof InvalidWidgetsError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
