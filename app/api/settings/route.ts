import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/config";
import { settingsInputSchema } from "@/lib/schema";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = settingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json(settings);
}
