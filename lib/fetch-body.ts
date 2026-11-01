import { log, hostOf } from "./log";

// Shared helper for server-side fetches of third-party bodies (calendar ICS,
// RSS/Atom, and the integration service clients): read a response body up to
// `max` bytes, returning null when it genuinely exceeds the cap — so an
// anonymous home-page load can never be made to buffer an unbounded body into
// memory.
//
// `trustContentLength` (default true) lets a caller reject early on a declared
// Content-Length over the cap, avoiding streaming a body a well-behaved server
// already says is too big. The integration clients pass `false`: a service
// (or a middlebox in front of it) can send a Content-Length that doesn't match
// the actual body, and a hard reject on that header wrongly reported a small
// response as "too large". With it off, the real body is streamed and only its
// actual size is capped — a mismatched header can't cause a false positive.
export async function readCapped(
  res: Response,
  max: number,
  opts: { trustContentLength?: boolean } = {}
): Promise<string | null> {
  const bytes = await readCappedBytes(res, max, opts);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

// Stream a response body, chunk by chunk, into `sink`, up to `max` bytes in
// total: true once the body has ended, false when it ran over the cap (the
// read is cancelled, so the rest is never pulled). readCappedBytes collects
// the chunks for the callers that need the whole body; the Portainer log
// tail demuxes its framed Docker stream as it arrives and keeps only a
// window of the end (#427), so for it the cap bounds what is read, not what
// is held.
export async function streamCapped(
  res: Response,
  max: number,
  sink: (chunk: Uint8Array) => void,
  { trustContentLength = true }: { trustContentLength?: boolean } = {}
): Promise<boolean> {
  const declared = Number(res.headers.get("content-length"));
  if (trustContentLength && Number.isFinite(declared) && declared > max) {
    log.warn("readCapped: declared content-length over cap", {
      host: hostOf(res.url),
      status: res.status,
      declared,
      max,
    });
    return false;
  }
  const reader = res.body?.getReader();
  // No body stream — an empty response, not an oversized one: nothing reaches
  // the sink, and the caller surfaces the empty body as a parse/validation
  // error (or an empty result), never as a misleading "too large".
  if (!reader) return true;
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return true;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      log.warn("readCapped: streamed body over cap", {
        host: hostOf(res.url),
        status: res.status,
        overBytes: max,
      });
      return false;
    }
    sink(value);
  }
}

// The same capped read, as the raw bytes, for a body that isn't text: an
// empty Buffer for no body, null over the cap, as with readCapped.
export async function readCappedBytes(
  res: Response,
  max: number,
  opts: { trustContentLength?: boolean } = {}
): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  const complete = await streamCapped(res, max, (chunk) => chunks.push(chunk), opts);
  if (!complete) return null;
  if (chunks.length === 1) {
    const one = chunks[0];
    return Buffer.from(one.buffer, one.byteOffset, one.byteLength);
  }
  return Buffer.concat(chunks);
}

// An AbortSignal that fires after `ms`. Built on a plain `controller.abort()`
// rather than AbortSignal.timeout() on purpose: a timed-out fetch (or body
// read) then rejects with an "AbortError" — the name errorReason() and every
// caller's "Timed out" mapping key on — not AbortSignal.timeout()'s
// "TimeoutError". The timer is never cleared: it has to keep running while the
// caller reads the body (clearing it once the headers arrive would let a
// slow-lorised body hang the caller), and aborting an already-consumed
// response is a no-op. It's unref'd so a pending one never holds the process
// open. Use this directly when several requests share one budget (the status
// check's HEAD → GET fallback); otherwise use fetchWithTimeout.
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return controller.signal;
}

// fetch, time-boxed to `timeoutMs`. The budget covers reading the body too
// (see timeoutSignal), so the caller's readCapped/json() stays inside it. A
// caller-supplied `init.signal` still aborts the request alongside the timeout.
export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const timeout = timeoutSignal(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}
