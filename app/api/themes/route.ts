import { NextRequest, NextResponse } from "next/server";
import { getThemeOverrides, setThemeOverrides } from "@/lib/config";
import { themesInputSchema } from "@/lib/schema";

export async function GET() {
  const themes = await getThemeOverrides();
  return NextResponse.json(themes);
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = themesInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const themes = await setThemeOverrides(parsed.data);
  return NextResponse.json(themes);
}
