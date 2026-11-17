// The generic API widget (#302): fetch a JSON endpoint on the server and turn
// it into what the widget shows. Only the mapped values (the view) reach the
// page — never the raw response — so a public widget shows exactly the fields
// the admin chose. Fetched through the shared stale-while-revalidate cache
// (lib/swr-cache.ts) with the widget's own refresh as the TTL, and through
// serviceRequest, so the timeout and size cap apply.
import type { InstanceOf } from "./schema";
import { parseJsonPath, selectPath } from "./json-query";
import { expandEnvRefs } from "./secrets";
import { ServiceError, parseJson, serviceRequest, throwForStatus } from "./services/http";
import { swrCache } from "./swr-cache";
import { log, errorReason } from "./log";

type ApiWidget = InstanceOf<"api">;

export type ApiTone = "ok" | "warn" | "critical";
export type ApiRow = { label: string; value: string };
export type ApiView =
  | { display: "stat"; label: string; value: string; unit: string; tone: ApiTone }
  | { display: "gauge"; label: string; value: string; unit: string; ratio: number; tone: ApiTone }
  | { display: "kv"; rows: ApiRow[] }
  | { display: "list"; rows: ApiRow[] };

// A response is capped well under the services' default: these are small
// status endpoints, and the parsed body sits in the cache between fetches.
export const API_MAX_BYTES = 1024 * 1024;
const LIST_CAP = 10;

// A value as shown: numbers trimmed to two decimals, text clipped, anything
// structured as compact JSON, missing as an em dash.
export function formatApiValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return v ? "yes" : "no";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

// The tint for a headline value against the widget's thresholds.
export function apiTone(value: unknown, t: ApiWidget["thresholds"]): ApiTone {
  const n = asNumber(value);
  if (n === null) return "ok";
  const past = (limit: number | null) => limit !== null && (t.direction === "above" ? n >= limit : n <= limit);
  return past(t.critical) ? "critical" : past(t.warn) ? "warn" : "ok";
}

// The value at a JSONPath, or a ServiceError naming the bad path.
function pick(data: unknown, path: string, what: string): unknown {
  const parsed = parseJsonPath(path.trim() || "$");
  if (!Array.isArray(parsed)) throw new ServiceError(`${what}: ${parsed.error}`);
  return selectPath(data, parsed).value;
}

// The view for a response. Pure; throws a ServiceError for a path that won't
// parse or a list path that isn't an array.
export function buildApiView(w: ApiWidget, data: unknown): ApiView {
  if (w.display === "kv") {
    return {
      display: "kv",
      rows: w.fields.map((f, i) => ({
        label: f.label || f.path,
        value: `${formatApiValue(pick(data, f.path, `Field ${i + 1}`))}${f.unit ? ` ${f.unit}` : ""}`,
      })),
    };
  }
  if (w.display === "list") {
    const items = pick(data, w.list.path, "List");
    if (!Array.isArray(items)) throw new ServiceError("The list path doesn't point at an array");
    return {
      display: "list",
      rows: items.slice(0, LIST_CAP).map((item) => ({
        label: formatApiValue(pick(item, w.list.label, "Item label")),
        value: w.list.value.trim() ? formatApiValue(pick(item, w.list.value, "Item value")) : "",
      })),
    };
  }
  const field = w.fields[0] ?? { label: "", path: "$", unit: "" };
  const raw = pick(data, field.path, "Field");
  const tone = apiTone(raw, w.thresholds);
  if (w.display === "gauge") {
    const n = asNumber(raw);
    return {
      display: "gauge",
      label: field.label,
      value: formatApiValue(raw),
      unit: field.unit,
      ratio: n === null ? 0 : Math.min(1, Math.max(0, n / w.max)),
      tone,
    };
  }
  return { display: "stat", label: field.label, value: formatApiValue(raw), unit: field.unit, tone };
}

// Fetch and parse the endpoint. Header values have their `${ENV}`
// references expanded here, server-side.
export async function fetchApiJson(w: Pick<ApiWidget, "url" | "method" | "headers" | "body">): Promise<unknown> {
  const url = w.url.trim();
  if (!/^https?:\/\//i.test(url)) throw new ServiceError("The URL must start with http:// or https://");
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const h of w.headers) {
    if (h.name.trim()) headers[h.name.trim()] = expandEnvRefs(h.value);
  }
  const init: RequestInit = { method: w.method, headers };
  if (w.method === "POST" && w.body.trim()) {
    init.body = w.body;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type"))
      headers["Content-Type"] = "application/json";
  }
  const { res, text } = await serviceRequest(expandEnvRefs(url), init, API_MAX_BYTES);
  throwForStatus(res);
  return parseJson(text);
}

export type ApiResult = { view: ApiView | null; error: string | null };

// What the fetch depends on: an edited URL or header refetches at once,
// while editing the fields or display just rebuilds the view from the cache.
const fingerprint = (w: ApiWidget) => JSON.stringify([w.url, w.method, w.headers, w.body]);

// `at` is when `data` was fetched: a failed refresh keeps the last good data
// and its time, with the error beside it.
type Cached = { data: unknown; error: string | null; at: number };

// The widget's last fetch, through the cache keyed by widget and
// fingerprint, with the widget's refresh as the TTL: the page and the alert
// check (#539) share one fetch.
function readCached(w: ApiWidget): Promise<Cached | undefined> {
  const cache = swrCache<Cached>(`api-widget:${w.refresh}`, w.refresh * 1000);
  const key = `${w.id}|${fingerprint(w)}`;
  return cache.get(key, async (prev) => {
    try {
      return { data: await fetchApiJson(w), error: null, at: Date.now() };
    } catch (e) {
      if (!(e instanceof ServiceError)) log.warn("api widget fetch error", { widget: w.id, reason: errorReason(e) });
      return {
        data: prev?.value.data ?? null,
        error: e instanceof ServiceError ? e.message : "Fetch failed",
        at: prev?.value.at ?? 0,
      };
    }
  });
}

// The widget's view. A failed refresh shows the last good data with the
// error beside it.
export async function getApiView(w: ApiWidget): Promise<ApiResult> {
  const entry = await readCached(w);
  if (!entry || entry.data === null) return { view: null, error: entry?.error ?? "No data" };
  try {
    return { view: buildApiView(w, entry.data), error: entry.error };
  } catch (e) {
    return { view: null, error: e instanceof ServiceError ? e.message : "Couldn't read the response" };
  }
}

// The headline number as the alert check reads it (#539): a stat's or a
// gauge's first field from the last fetch, as shown ("92 %"), and when that
// fetch was, so the check counts each reading once. Null while the last
// fetch failed (the last good data isn't a new reading) or the value isn't a
// number: either leaves the alert state as it was.
export type ApiHeadline = { at: number; value: number; text: string };
export async function getApiHeadline(w: ApiWidget): Promise<ApiHeadline | null> {
  if (w.display !== "stat" && w.display !== "gauge") return null;
  const entry = await readCached(w);
  if (!entry || entry.error !== null || entry.data === null) return null;
  const field = w.fields[0] ?? { label: "", path: "$", unit: "" };
  let raw: unknown;
  try {
    raw = pick(entry.data, field.path, "Field");
  } catch {
    return null;
  }
  const value = asNumber(raw);
  if (value === null) return null;
  return { at: entry.at, value, text: `${formatApiValue(raw)}${field.unit ? ` ${field.unit}` : ""}` };
}
