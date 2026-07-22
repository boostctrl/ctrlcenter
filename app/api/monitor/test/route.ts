import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/api-auth";
import { MONITOR_SERVICE_IDS } from "@/lib/monitor";
import { probeQbittorrent } from "@/lib/services/qbittorrent";
import { probeArr } from "@/lib/services/arr";

// Admin-only "Test connection" for the Integrations settings: probes the
// values currently in the form — before saving — and reports what answered
// ("qBittorrent v5.0.1"), mirroring /api/calendar/test. Proxy-gated by the
// /api/monitor prefix; the explicit session check matches the sibling route.
const bodySchema = z.object({
  service: z.enum(MONITOR_SERVICE_IDS),
  url: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  apiKey: z.string().default(""),
});

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { service, url, username, password, apiKey } = parsed.data;
  if (!url.trim()) {
    return NextResponse.json({ ok: false, error: "No URL set" });
  }
  const result =
    service === "qbittorrent"
      ? await probeQbittorrent({ url, username, password })
      : await probeArr(service, { url, apiKey });
  return NextResponse.json(result);
}
