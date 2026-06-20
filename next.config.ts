import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Pragmatic CSP. 'unsafe-inline' is required for Next's inline bootstrap script
// and the inline style attributes (accent vars, animation delays); 'unsafe-eval'
// is only needed in dev for React Fast Refresh. img-src allows the icon CDN and
// any https/data image an admin configures. A nonce-based strict CSP is tracked
// as a follow-up. frame-ancestors blocks clickjacking of the admin UI.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self'",
]
  .join("; ")
  .concat(isDev ? "" : "; upgrade-insecure-requests");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
