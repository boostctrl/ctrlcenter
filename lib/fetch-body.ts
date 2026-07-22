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
  { trustContentLength = true }: { trustContentLength?: boolean } = {}
): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (trustContentLength && Number.isFinite(declared) && declared > max) {
    log.warn("readCapped: declared content-length over cap", {
      host: hostOf(res.url),
      status: res.status,
      declared,
      max,
    });
    return null;
  }
  const reader = res.body?.getReader();
  // No body stream — an empty response, not an oversized one. Return "" so the
  // caller surfaces it as a parse/validation error (or an empty result), never
  // as a misleading "too large".
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      log.warn("readCapped: streamed body over cap", {
        host: hostOf(res.url),
        status: res.status,
        overBytes: max,
      });
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  );
}
