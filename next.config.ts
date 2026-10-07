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
  // Automatic memoization: the compiler inserts what hand-written useMemo /
  // useCallback would, so the large client providers (PrefsProvider, the
  // dashboard) stop re-rendering every consumer on unrelated changes. The
  // react-hooks lint rules (eslint-config-next) enforce the code it needs.
  reactCompiler: true,
  // The app renders icons with plain <img> (arbitrary admin-chosen URLs) and
  // never uses next/image, so the /_next/image optimizer is dead weight — and
  // it's had its own advisories (AVIF RCE, SVG DoS). Unoptimized means Next
  // doesn't serve that endpoint at all.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
