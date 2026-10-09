import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { sendTestAlert } from "@/lib/alerts";

// Admin-only: send a synthetic "down" alert through the real delivery path so
// the admin can confirm a channel actually delivers, without waiting for a
// real outage. Gated here like /api/feed/test. The test uses the saved config
// (settings autosave, so it matches the form): `{ channel: id }` tests that
// one channel, no body tests every active one. Returns a result per channel
// attempted; an empty list when none could be.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const channel =
    body && typeof body === "object" && typeof (body as { channel?: unknown }).channel === "string"
      ? (body as { channel: string }).channel
      : undefined;
  const config = await readConfigInternal();
  return NextResponse.json(await sendTestAlert(config.settings.alerts, channel));
}
