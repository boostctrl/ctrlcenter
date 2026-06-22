import { NextRequest, NextResponse } from "next/server";
import { readConfig, replaceConfig } from "@/lib/config";
import { configSchema } from "@/lib/schema";

// Admin-only (gated by the proxy matcher). GET exports the full config for
// backup; POST imports/replaces it after validation.
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readConfig();
  return NextResponse.json(config, {
    headers: {
      "Content-Disposition": 'attachment; filename="ctrlcenter-config.json"',
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That doesn't look like a valid ctrlcenter config file." },
      { status: 400 }
    );
  }
  const config = await replaceConfig(parsed.data);
  return NextResponse.json(config);
}
