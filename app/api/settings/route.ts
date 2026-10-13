import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { getSettings, readConfigInternal, updateSettings } from "@/lib/config";
import { settingsInputSchema } from "@/lib/schema";
import { requireRecentAuth } from "@/lib/reauth";
import { alertChannelsChangeTarget } from "@/lib/reauth-targets";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = settingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // Step-up (#378) when the save re-points an email channel's SMTP server,
  // which the password (CTRLCENTER_SMTP_PASS, when set) signs in to.
  const channels = parsed.data.alerts?.channels;
  if (channels) {
    const { auth, settings: stored } = await readConfigInternal();
    if (alertChannelsChangeTarget(channels, stored.alerts.channels)) {
      const recent = await requireRecentAuth(request, auth.passwordHash);
      if (!recent.ok) return recent.response;
    }
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json(settings);
}
