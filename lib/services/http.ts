// Shared plumbing for the integration service clients (lib/services/*): a
// timeout-bounded, size-capped request whose failures map to short reasons
// that are safe to render in the admin UI (no URLs, no credentials — those
// stay in the server log, host-only). Every caller is server-side and
// admin-gated (the monitor cache, the test-connection route); nothing here
// ever runs in the browser.

import https from "node:https";
import { readCapped, timeoutSignal } from "../fetch-body";
import { log, hostOf, errorReason } from "../log";

export const SERVICE_TIMEOUT_MS = 6000;
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

// Redirects (#389). fetch follows them on its own, and on a hop to another
// host undici drops only Authorization and Cookie: a service's X-Api-Key, an
// API widget's headers and, on a 307/308, a login body would all go along to
// wherever the service points (a Sonarr behind an auth proxy that bounces to
// its sign-in host, a LAN URL that 301s to a public name). So a service
// request follows a redirect by hand, and only on the same host: a trailing
// slash, a moved path, or an upgrade to https. Anything else stops with a
// message for the admin, and the credentials stay where they were saved.
export const MAX_SERVICE_REDIRECTS = 5;
export const REDIRECTED_AWAY = "Redirected to another host — check the URL";

const isRedirect = (status: number) => [301, 302, 303, 307, 308].includes(status);

// Whether a redirect from `from` to `to` keeps to the saved service: the same
// host name (any port), and never from https down to plain http.
function sameService(from: URL, to: URL): boolean {
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;
  if (from.protocol === "https:" && to.protocol === "http:") return false;
  return to.hostname === from.hostname;
}

// fetch a service URL, time-boxed to `timeoutMs` (the body read included,
// as with fetchWithTimeout), following only same-service redirects. A 303,
// or a 301/302 to a POST, carries on as a body-less GET, as fetch would.
export async function serviceFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = SERVICE_TIMEOUT_MS
): Promise<Response> {
  const timeout = timeoutSignal(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const saved = new URL(url);
  let at = saved;
  let req: RequestInit = { ...init, redirect: "manual", signal };
  for (let hops = 0; ; hops++) {
    const res = await fetch(hops === 0 ? url : at.href, req);
    const location = res.headers.get("location");
    if (!isRedirect(res.status) || location === null) return res;
    void res.body?.cancel().catch(() => {});
    let next: URL;
    try {
      next = new URL(location, at);
    } catch {
      throw new ServiceError(REDIRECTED_AWAY);
    }
    if (!sameService(saved, next)) {
      log.warn("service redirect refused", { host: hostOf(url), to: next.hostname });
      throw new ServiceError(REDIRECTED_AWAY);
    }
    if (hops >= MAX_SERVICE_REDIRECTS) throw new ServiceError("Too many redirects");
    const method = (req.method ?? "GET").toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      req = { ...req, method: method === "HEAD" ? "HEAD" : "GET", body: undefined };
    }
    at = next;
  }
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
  try {
    const res = await serviceFetch(url, init);
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
  }
}

export type InsecureResponse = {
  status: number;
  ok: boolean;
  // Raw Set-Cookie headers (an array, unlike fetch's combined single string) —
  // a session login needs the individual cookies intact.
  setCookie: string[];
  text: string;
};

// A timeout-bounded, size-capped HTTPS request that does NOT verify the
// server's certificate. Only for an integration the admin has explicitly
// marked `allowInsecureTls`, and only reachable for an https URL — it exists
// for controllers that ship a self-signed cert with no plaintext-HTTP
// alternative (a UniFi gateway). node:https rather than fetch because Node's
// global fetch (undici) can't be told to skip certificate verification
// without pulling undici's Agent in as a dependency. Same failure vocabulary
// as serviceRequest so callers map errors identically.
export async function insecureHttpsRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  maxBytes: number = SERVICE_MAX_BYTES
): Promise<InsecureResponse> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new ServiceError("Set a valid http(s) URL");
  }
  return new Promise<InsecureResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const req = https.request(
      target,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        rejectUnauthorized: false,
        timeout: SERVICE_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            settle(() => reject(new ServiceError("Response too large")));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          settle(() => {
            const status = res.statusCode ?? 0;
            resolve({
              status,
              ok: status >= 200 && status < 300,
              setCookie: res.headers["set-cookie"] ?? [],
              text: Buffer.concat(chunks).toString("utf8"),
            });
          })
        );
      }
    );
    req.on("timeout", () => {
      settle(() => reject(new ServiceError("Timed out")));
      req.destroy();
    });
    req.on("error", (e) =>
      settle(() => {
        log.warn("insecure service fetch error", {
          host: hostOf(url),
          reason: errorReason(e),
        });
        reject(new ServiceError("Couldn't connect"));
      })
    );
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

// GET a service endpoint and parse the JSON body. `maxBytes` lets a call that
// legitimately returns a large body (a TrueNAS host with many apps) raise the
// default cap so it isn't rejected as "Response too large".
export async function serviceJson<T>(
  url: string,
  init: RequestInit = {},
  maxBytes: number = SERVICE_MAX_BYTES
): Promise<T> {
  const { res, text } = await serviceRequest(url, init, maxBytes);
  throwForStatus(res);
  return parseJson<T>(text);
}

// Throw the admin-facing ServiceError for a failed response. `messages` maps
// the statuses a service uses to mean something specific (a rejected API key,
// a banned IP) to a message in the admin's terms; any other non-2xx becomes
// `HTTP <status>`. A 2xx passes. Takes any { status, ok } so the fetch
// Response and insecureHttpsRequest's result map identically.
export function throwForStatus(
  res: { status: number; ok: boolean },
  messages: Readonly<Record<number, string>> = {}
): void {
  const message = messages[res.status];
  if (message !== undefined) throw new ServiceError(message);
  if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
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
