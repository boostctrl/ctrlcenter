import { NextRequest, NextResponse } from "next/server";
import { isHttps, sessionTokenFrom, verifySession } from "@/lib/auth";
import { sessionNeedsTwoFactor } from "@/lib/accounts";
import { readConfigInternal } from "@/lib/config";
import { allowedBeforeTwoFactor, TWO_FACTOR_SETUP_PAGE } from "@/lib/two-factor-gate";
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
  // The groups list (#505).
  "/api/account-groups",
  // Signing in through a provider: its settings (#504).
  "/api/sign-in",
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
  const token = sessionTokenFrom(request.cookies);
  const isApi = pathname.startsWith("/api/");
  // An account an admin requires two-factor of, and that has none yet, is
  // held to its own page until it sets one up (#449): any other page sends
  // it there, and an admin API refuses it (the rest judge it as a visitor,
  // lib/api-auth.ts). Only a request that carries a session is looked at,
  // so a visitor's costs nothing more.
  const held = async (auth: Awaited<ReturnType<typeof readConfigInternal>>["auth"]) => {
    const live = await verifySession(token, auth);
    return { live, held: !!live && sessionNeedsTwoFactor(live.account, live.session) && !allowedBeforeTwoFactor(pathname) };
  };
  const toSetup = () => {
    if (isApi) {
      return withCsp(
        NextResponse.json({ error: "Set up two-factor authentication on your account page first" }, { status: 403 })
      );
    }
    return withCsp(NextResponse.redirect(new URL(TWO_FACTOR_SETUP_PAGE, request.url)));
  };

  if (!needsAuth(pathname)) {
    if (!token || isApi || allowedBeforeTwoFactor(pathname)) return pass();
    const { auth } = await readConfigInternal();
    return (await held(auth)).held ? toSetup() : pass();
  }

  // Verify against the accounts' current password hashes so a password
  // change revokes that account's sessions (the proxy runs in the Node
  // runtime, so it can read config).
  const { auth } = await readConfigInternal();
  const check = await held(auth);
  if (check.held) return toSetup();
  if (check.live) return pass();

  if (isApi) {
    return withCsp(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return withCsp(NextResponse.redirect(loginUrl));
}
