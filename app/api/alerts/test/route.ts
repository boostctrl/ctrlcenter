import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfig } from "@/lib/config";
import { sendTestAlert } from "@/lib/alerts";

// Admin-only: send a synthetic "down" alert through the real webhook/email
// paths so the admin can confirm each configured channel actually delivers,
// without waiting for a real outage. Gated here like /api/feed/test. No body —
// the test uses the currently saved config (settings autosave, so it matches
// the form). Returns a per-channel result; `{}` when nothing is configured.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await readConfig();
  const result = await sendTestAlert(config.settings.alerts);
  return NextResponse.json(result);
}
