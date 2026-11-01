import { NextRequest, NextResponse } from "next/server";
import { restoreSettingsPatch, settingsForAdmin } from "@/lib/config";
import { alertChannelsDropSecurity } from "@/lib/reauth-targets";
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
  // Credentials stay on the server (#382): placeholders in their place.
  return NextResponse.json(settingsForAdmin(settings));
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
  // A placeholder the form sent back stands for the stored credential (#382).
  const { auth, settings: stored } = await readConfigInternal();
  const patch = restoreSettingsPatch(parsed.data, stored);
  // Step-up (#378) when the save re-points an email channel's SMTP server,
  // which the password (CTRLCENTER_SMTP_PASS, when set) signs in to, and
  // (#382) when it would silence the Security notifications.
  const channels = patch.alerts?.channels;
  if (
    channels &&
    (alertChannelsChangeTarget(channels, stored.alerts.channels) ||
      alertChannelsDropSecurity(channels, stored.alerts.channels))
  ) {
    const recent = await requireRecentAuth(request, auth);
    if (!recent.ok) return recent.response;
  }
  const settings = await updateSettings(patch);
  return NextResponse.json(settingsForAdmin(settings));
}
