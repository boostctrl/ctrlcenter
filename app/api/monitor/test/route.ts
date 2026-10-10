import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/api-auth";
import { SERVICE_IDS, SERVICES } from "@/lib/services/registry";
import { getSiteConfig } from "@/lib/config";
import { resolveIntegration } from "@/lib/services/resolve";
import { isSavedUrl, withoutEnvSecrets } from "@/lib/secrets";

// Admin-only "Test connection" for the Integrations settings: probes the
// values currently in the form — before saving — and reports what answered
// ("qBittorrent v5.0.1"), mirroring /api/calendar/test. Proxy-gated by the
// /api/monitor prefix; the explicit session check matches the sibling route.
// Dispatches through the service registry (#212): the body carries the
// superset of credential fields and each service's probe reads its own.
const bodySchema = z.object({
  service: z.enum(SERVICE_IDS),
  // The integration being edited (#300), when it's been saved: the saved
  // values stand in for env references and legacy env names only for its own
  // saved URL.
  integration: z.string().max(64).default(""),
  url: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  apiKey: z.string().default(""),
  allowInsecureTls: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { service, integration, ...fields } = parsed.data;
  if (!fields.url.trim()) {
    return NextResponse.json({ ok: false, error: "No URL set" });
  }
  // Env-held credentials — `${ENV}` references, and the legacy
  // CTRLCENTER_*_KEY/PASS for a migrated integration — only go to the saved
  // URL of the integration being edited; a probe of a newly typed URL runs
  // with them expanded to nothing.
  const saved = (await getSiteConfig()).integrations.find(
    (i) => i.id === integration && i.type === service
  );
  const run = () =>
    SERVICES[service].probe(resolveIntegration({ ...fields, id: integration, type: service }));
  const result =
    saved && isSavedUrl(fields.url, saved.url)
      ? await run()
      : await withoutEnvSecrets(run);
  return NextResponse.json(result);
}
