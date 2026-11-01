import { NextRequest, NextResponse } from "next/server";
import { isHttps, sessionTokenFrom, verifySessionToken } from "@/lib/auth";
import { readConfigInternal } from "@/lib/config";
import { contentSecurityPolicy } from "@/lib/csp";

// Run on every routed request (HTML + API), excluding Next internals and static
// files, so the per-request CSP nonce is applied everywhere. Auth gating is
// scoped to the admin paths below.
export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.[\\w]+$).*)"],
};

const ADMIN_PREFIXES = [
  "/admin",
  "/api/apps",
  "/api/bookmarks",
  "/api/settings",
  "/api/themes",
  "/api/config",
  "/api/password",
  // Widget instances (#297), boards (#298), groups (#299) and integrations
  // (#300); the routes re-check too.
  "/api/widgets",
  "/api/boards",
  "/api/groups",
  "/api/integrations",
  // Managing the TOTP second factor (#198): enroll/activate/disable are
  // admin-only. The login step itself (/api/login) stays public.
  "/api/2fa",
  // Integration snapshots + test probes (#189): infrastructure internals,
  // never served anonymously. The routes re-check the session themselves too.
  "/api/monitor",
  // Sending a test alert or a sample event (#347) through the saved
  // channels is admin-only; the one route under it re-checks too.
  "/api/alerts",
  // The active sessions and the idle timeout (#365), and the security
  // checklist (#367).
  "/api/sessions",
  "/api/security",
  // The accounts list for the admin's pickers (#423).
  "/api/accounts",
  // Step-up confirmation (#366).
  "/api/reauth",
];

function needsAuth(pathname: string): boolean {
  if (pathname === "/admin/login") return false;
  return ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");

  // Pass the nonce down to the app (and let Next nonce its own scripts via the
  // CSP request header), and set the CSP on every response we return.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  // The path, for the root layout: a board's own theme (#337) paints from
  // the first byte when the layout knows which board the request shows.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // HSTS (#369) is opt-in — HSTS=1 — and only on responses that arrived over
  // HTTPS: TLS normally terminates at the reverse proxy, which usually adds
  // the header itself; this is for the ones that don't. Never on plain HTTP,
  // where the header would be ignored at best.
  const hsts = process.env.HSTS === "1" && isHttps(request);
  const withCsp = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp);
    if (hsts) res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    return res;
  };
  const pass = () =>
    withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  const { pathname } = request.nextUrl;
  if (!needsAuth(pathname)) return pass();

  const token = sessionTokenFrom(request.cookies);
  // Verify against the accounts' current password hashes so a password
  // change revokes that account's sessions (the proxy runs in the Node
  // runtime, so it can read config).
  const { auth } = await readConfigInternal();
  if (await verifySessionToken(token, auth)) return pass();

  if (pathname.startsWith("/api/")) {
    return withCsp(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return withCsp(NextResponse.redirect(loginUrl));
}
