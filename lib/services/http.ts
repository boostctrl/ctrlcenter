// Shared plumbing for the integration service clients (lib/services/*): a
// timeout-bounded, size-capped request whose failures map to short reasons
// that are safe to render in the admin UI (no URLs, no credentials — those
// stay in the server log, host-only). Every caller is server-side and
// admin-gated (the monitor cache, the test-connection route); nothing here
// ever runs in the browser.

import { readCapped } from "../fetch-body";
import { log, hostOf, errorReason } from "../log";

const SERVICE_TIMEOUT_MS = 6000;
// Default cap on a service response body — enough for the small status/queue
// payloads. A specific call that legitimately returns a larger body (the
// qBittorrent torrent list on a big instance) passes its own higher cap; see
// serviceRequest's `maxBytes` and QBITTORRENT_MAX_BYTES.
export const SERVICE_MAX_BYTES = 4 * 1024 * 1024;

// A failure whose message is written for the admin's eyes — thrown by the
// clients, shown verbatim on the monitor cards and the test-connection button.
export class ServiceError extends Error {}

// The base URL with trailing slashes trimmed, so path joins are uniform.
// Throws when it isn't http(s): integration URLs are validated on the admin
// path, but a hand-edited config must fail with a message, not a bad fetch.
export function serviceBase(url: string): string {
  const base = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    throw new ServiceError("Set a valid http(s) URL");
  }
  return base;
}

// Fetch a service endpoint and read its body, both inside one timeout window
// (clearing the timer before the body arrives would let a slow-lorised body
// hang the caller — the same reason lib/feed.ts reads inside its timer). The
// Response's status/headers are still needed by callers (qBittorrent's 403 →
// re-login, its login set-cookie), so both come back.
export async function serviceRequest(
  url: string,
  init: RequestInit = {},
  maxBytes: number = SERVICE_MAX_BYTES
): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Read the actual body and cap on its real size — do NOT reject on a
    // declared Content-Length that may not match (a service or a middlebox in
    // front of it can send a header far larger than the body, which used to
    // fail even a few-byte login response as "too large").
    const text = await readCapped(res, maxBytes, { trustContentLength: false });
    if (text === null) throw new ServiceError("Response too large");
    return { res, text };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    log.warn("service fetch error", {
      host: hostOf(url),
      reason: errorReason(e),
    });
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ServiceError(aborted ? "Timed out" : "Couldn't connect");
  } finally {
    clearTimeout(timer);
  }
}

// GET a service endpoint and parse the JSON body.
export async function serviceJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const { res, text } = await serviceRequest(url, init);
  if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
  return parseJson<T>(text);
}

export function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ServiceError("Not a JSON response");
  }
}

// The uniform shape of a "Test connection" probe: `detail` names what
// answered ("qBittorrent v5.0.1") so the admin knows the right service is on
// the other end, not just that something spoke HTTP.
export type ProbeResult = { ok: boolean; detail?: string; error?: string };

// Run a probe body, folding a thrown ServiceError into the result shape. An
// unexpected error is logged and reported generically — its message wasn't
// written for the UI and could echo internals.
export async function runProbe(
  service: string,
  fn: () => Promise<string>
): Promise<ProbeResult> {
  try {
    return { ok: true, detail: await fn() };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, error: e.message };
    log.warn("integration probe error", { service, reason: errorReason(e) });
    return { ok: false, error: "Probe failed" };
  }
}
