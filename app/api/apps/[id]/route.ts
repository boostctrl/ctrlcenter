import { NextRequest, NextResponse } from "next/server";
import { updateApp, deleteApp } from "@/lib/config";
import { itemMutationErrorResponse } from "@/lib/api-errors";
import { appUpdateSchema } from "@/lib/schema";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = appUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const app = await updateApp(id, parsed.data);
    return NextResponse.json(app);
  } catch (error) {
    return itemMutationErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteApp(id);
  return NextResponse.json({ ok: true });
}
