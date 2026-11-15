// A count shortened for a tile or a stat: whole below 10,000, then
// thousands, then millions from 999,950, where thousands would round to
// "1000.0k" (#490). Locale-independent, so it renders the same on the server
// and the client.
export function formatCount(n: number): string {
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
