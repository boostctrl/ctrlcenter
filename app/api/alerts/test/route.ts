import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { sendSampleNotification, sendTestAlert } from "@/lib/alerts";
import { SAMPLE_IDS } from "@/lib/notification-samples";

// Admin-only: send a synthetic "down" alert through the real delivery path so
// the admin can confirm a channel actually delivers, without waiting for a
// real outage — or, with `sample`, one of the sample inbound-webhook events
// (#347) so the report options can be seen where they land. Gated here like
// /api/feed/test, and by the proxy's /api/alerts prefix. The test uses the
// saved config (settings autosave, so it matches the form): `{ channel: id }`
// tests that one channel, no body tests every active one. Returns a result
// per channel attempted; an empty list when none could be.
const bodySchema = z.object({
  channel: z.string().max(64).optional(),
  sample: z.enum(SAMPLE_IDS).optional(),
});

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // A bodyless POST (the channel's own Send test) is the empty patch.
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unknown sample", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { channel, sample } = parsed.data;
  const { settings } = await readConfigInternal();
  return NextResponse.json(
    sample === undefined
      ? await sendTestAlert(settings.alerts, channel)
      : await sendSampleNotification(settings, sample, channel)
  );
}
