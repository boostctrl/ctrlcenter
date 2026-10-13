import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/api-auth";
import { getSiteConfig } from "@/lib/config";
import { buildApiView, fetchApiJson } from "@/lib/api-widget";
import { ServiceError } from "@/lib/services/http";
import { isSavedUrl, withoutEnvSecrets } from "@/lib/secrets";
import { widgetInstanceSchema, type InstanceOf } from "@/lib/schema";

// Admin-only "Test" for an API widget (#302): fetch the endpoint with the
// values in the form (before saving) and answer with the raw response
// (clipped) beside the mapped view, so the admin can see what their paths
// pick out. `${ENV}` references only expand for the widget's own saved
// request — the same URL, method, headers and body (#378); anything typed
// differently gets them as nothing, so a probe can't carry a secret to a new
// host, or into a header the saved request doesn't send.
const RAW_CAP = 4000;
const bodySchema = z.object({ widget: widgetInstanceSchema });

type ApiRequest = Pick<InstanceOf<"api">, "url" | "method" | "headers" | "body">;
function isSavedRequest(w: ApiRequest, saved: ApiRequest): boolean {
  const headers = (r: ApiRequest) => JSON.stringify(r.headers.map((h) => [h.name, h.value]));
  return (
    isSavedUrl(w.url, saved.url) &&
    w.method === saved.method &&
    w.body === saved.body &&
    headers(w) === headers(saved)
  );
}

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
  const own = saved?.type === "api" && isSavedRequest(w, saved);
  try {
    const data = await (own ? fetchApiJson(w) : withoutEnvSecrets(() => fetchApiJson(w)));
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
