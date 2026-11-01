import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { requireRecentAuth } from "@/lib/reauth";
import { WEBHOOK_SERVICES, type WebhookService } from "@/lib/schema";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";

// The inbound-webhook token for one service, for the admin to paste into
// Sonarr, Radarr or Seerr (#382). The settings the forms hold carry a
// placeholder instead; reading the token itself takes a recent confirmation,
// and lands in the audit log, like an export with secrets.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const service = request.nextUrl.searchParams.get("service") ?? "";
  if (!(WEBHOOK_SERVICES as readonly string[]).includes(service)) {
    return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  }
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  await recordSecurityEvent("secret.revealed", eventMeta(request), `${service} webhook token`);
  return NextResponse.json({ token: config.settings.webhooks[service as WebhookService].token });
}
