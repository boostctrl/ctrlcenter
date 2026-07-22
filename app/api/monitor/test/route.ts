import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/api-auth";
import { SERVICE_IDS, SERVICES } from "@/lib/services/registry";

// Admin-only "Test connection" for the Integrations settings: probes the
// values currently in the form — before saving — and reports what answered
// ("qBittorrent v5.0.1"), mirroring /api/calendar/test. Proxy-gated by the
// /api/monitor prefix; the explicit session check matches the sibling route.
// Dispatches through the service registry (#212): the body carries the
// superset of credential fields and each service's probe reads its own.
const bodySchema = z.object({
  service: z.enum(SERVICE_IDS),
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
  const { service, ...fields } = parsed.data;
  if (!fields.url.trim()) {
    return NextResponse.json({ ok: false, error: "No URL set" });
  }
  return NextResponse.json(await SERVICES[service].probe(fields));
}
