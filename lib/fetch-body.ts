// Shared helper for server-side fetches of third-party feeds (calendar ICS,
// RSS/Atom): read a response body up to `max` bytes, returning null when it
// exceeds the cap (via Content-Length up front, then while streaming for
// chunked responses) — so an anonymous home-page load can never be made to
// buffer an unbounded body into memory.
export async function readCapped(
  res: Response,
  max: number
): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  );
}
