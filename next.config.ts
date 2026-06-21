import type { NextConfig } from "next";

// The Content-Security-Policy is set per-request in proxy.ts so script-src can
// use a nonce instead of 'unsafe-inline'. The remaining headers are static and
// live here.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Allow geolocation for same-origin only (the "Use my location" button);
    // an empty allowlist would disable it even for our own page.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
