import { NextRequest, NextResponse } from "next/server";
import { listApps, createApp, reorderApps } from "@/lib/config";
import { appInputSchema, reorderSchema } from "@/lib/schema";

export async function GET() {
  const apps = await listApps();
  return NextResponse.json(apps);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = appInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const app = await createApp(parsed.data);
  return NextResponse.json(app, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const apps = await reorderApps(parsed.data.ids);
  return NextResponse.json(apps);
}
