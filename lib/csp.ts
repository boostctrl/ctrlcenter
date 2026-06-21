// Content-Security-Policy, built per-request so script-src can use a nonce
// instead of 'unsafe-inline'. Set from the proxy (Next 16 proxy runs in the
// Node runtime and on every routed request), not next.config, because the nonce
// changes each request. Mirrors the directives that used to live in next.config.
//
// In production, scripts are allowed only via the nonce + 'strict-dynamic' (so
// Next's nonce'd bootstrap can load its chunks); 'self' is kept as a fallback
// for browsers without strict-dynamic. In dev we keep 'unsafe-inline'/'eval'
// for React Fast Refresh (a nonce + 'unsafe-inline' would cancel out anyway).
//
// style-src keeps 'unsafe-inline': inline style *attributes* (accent vars,
// animation delays, gradient previews) are pervasive and can't carry a nonce;
// CSS injection is far lower-risk than script injection.
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    // Client-side weather (Open-Meteo), per-visitor location auto-detection (IP
    // lookup + reverse geocoding), and the icon index/metadata fetches.
    "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://ipwho.is https://api.bigdatacloud.net https://cdn.jsdelivr.net",
  ].join("; ");
}
