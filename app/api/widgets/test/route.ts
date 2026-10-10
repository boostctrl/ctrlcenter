import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/api-auth";
import { getSiteConfig } from "@/lib/config";
import { buildApiView, fetchApiJson } from "@/lib/api-widget";
import { ServiceError } from "@/lib/services/http";
import { isSavedUrl, withoutEnvSecrets } from "@/lib/secrets";
import { widgetInstanceSchema } from "@/lib/schema";

// Admin-only "Test" for an API widget (#302): fetch the endpoint with the
// values in the form (before saving) and answer with the raw response
// (clipped) beside the mapped view, so the admin can see what their paths
// pick out. `${ENV}` references in the headers only expand for the widget's
// own saved URL; any other URL gets them as nothing.
const RAW_CAP = 4000;
const bodySchema = z.object({ widget: widgetInstanceSchema });

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.widget.type !== "api") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const w = parsed.data.widget;
  const saved = (await getSiteConfig()).widgets.find((x) => x.id === w.id);
  const ownUrl = saved?.type === "api" && isSavedUrl(w.url, saved.url);
  try {
    const data = await (ownUrl ? fetchApiJson(w) : withoutEnvSecrets(() => fetchApiJson(w)));
    const pretty = JSON.stringify(data, null, 2);
    const raw = pretty.length > RAW_CAP ? `${pretty.slice(0, RAW_CAP)}\n…` : pretty;
    try {
      return NextResponse.json({ ok: true, raw, view: buildApiView(w, data) });
    } catch (e) {
      return NextResponse.json({ ok: false, raw, error: e instanceof ServiceError ? e.message : "Couldn't map it" });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof ServiceError ? e.message : "Fetch failed" });
  }
}
