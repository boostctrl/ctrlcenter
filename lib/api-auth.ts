import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth";
import { readConfigInternal, stripAuth, stripSecrets } from "./config";
import type { Config } from "./schema";

// Route-level admin check for endpoints the proxy's path-prefix allowlist can't
// gate. The icons API is the case: individual icons (GET /api/icons/[name]) must
// be public because they render on the unauthenticated dashboard, while listing,
// uploading, and deleting (the /api/icons collection) must be admin-only — so a
// single prefix in the proxy can't express it. Mirrors the proxy's verification
// (token signed against the current password hash, so a password change revokes
// outstanding sessions).
//
// Writes (any non-GET/HEAD/OPTIONS method) must also pass the same-origin
// check below, so a valid cookie alone can't authorize a cross-site request.
//
// Callers that already hold the config pass `passwordHash` so the check doesn't
// read and parse config.yaml a second time in the same request — the status
// APIs are polled by every open dashboard tab, so the double read adds up.
export async function isAdminRequest(
  request: NextRequest,
  passwordHash?: string
): Promise<boolean> {
  if (!isSafeMethod(request.method) && !isSameOriginRequest(request)) {
    return false;
  }
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hash = passwordHash ?? (await readConfigInternal()).auth.passwordHash;
  return verifySessionToken(token, hash);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

// CSRF defense for cookie-authenticated writes. The session cookie is
// SameSite=Lax, which still rides along on requests from *same-site* origins —
// another service on a sibling subdomain of the same homelab domain, say — so
// a state-changing request must also prove it came from this origin:
//
//   - Sec-Fetch-Site (every current browser sends it, and pages can't forge
//     it) must be "same-origin", or "none" for a user-initiated navigation.
//   - Without it, an Origin header must name this host. Behind a reverse proxy
//     the public host arrives as X-Forwarded-Host, so that's accepted too.
//   - With neither header the request didn't come from a browser page (curl,
//     scripts, health checks), so there's no cross-site page to defend against.
//
// Built into isAdminRequest so every admin mutation gets it, and called
// directly by the session-issuing routes (login/logout).
export function isSameOriginRequest(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // "null" (sandboxed/opaque origin) or garbage
  }
  const hosts = [
    request.headers.get("host"),
    ...(request.headers.get("x-forwarded-host") ?? "").split(","),
  ].map((h) => h?.trim().toLowerCase());
  return hosts.includes(originHost.toLowerCase());
}

// Same check for server components (no NextRequest there — the cookie comes
// from next/headers). Lets a page decide whether to offer admin affordances
// like the home-page layout editor; the APIs those affordances call re-check
// the session themselves, so this is presentation-only trust. Same optional
// `passwordHash` fast path as isAdminRequest.
export async function isAdminSession(passwordHash?: string): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const hash = passwordHash ?? (await readConfigInternal()).auth.passwordHash;
  return verifySessionToken(token, hash);
}

// Page-level gate for everything under /admin (except the login page itself).
// The proxy already redirects signed-out visitors, but a page that renders
// secrets (the admin portal hands the full settings to its client tree) must
// not depend on the proxy alone: a proxy bypass would otherwise serve them.
// Redirects exactly like the proxy does, so the login page sends the admin
// back here afterwards.
export async function requireAdminPage(
  next: string,
  passwordHash?: string
): Promise<void> {
  if (await isAdminSession(passwordHash)) return;
  redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}

// Items flagged `private` (apps and bookmarks) exist only for the admin
// session. Public pages get this applied for free via readPublicConfig below;
// the status APIs call it directly because they filter per response over a
// shared all-apps cache. The background poller, history recording, and alerts
// deliberately bypass it: a private service should still be monitored, it
// just shouldn't render for guests.
export function visibleItems<T extends { private: boolean }>(
  items: T[],
  isAdmin: boolean
): T[] {
  return isAdmin ? items : items.filter((i) => !i.private);
}

// The one config accessor for anything a signed-out visitor might see (#147,
// #157). Private apps and bookmarks are filtered out for guests; the admin
// credential (stripAuth) and the settings-embedded secrets — calendar
// credentials, alert webhook/SMTP (stripSecrets) — are stripped too. So a new
// public page or endpoint built on this can't leak any of them by forgetting a
// filter: the object returned is safe to serialize to a client component. Route
// handlers pass their NextRequest (the isAdminRequest path); server components
// omit it (the isAdminSession path). Surfaces that genuinely need the full list
// or the real secrets — the poller, alerts, the calendar fetch (getCalendarAuth),
// admin routes — use readConfigInternal, and a test pins which files under app/
// may do so.
export async function readPublicConfig(request?: NextRequest): Promise<{
  config: Omit<Config, "auth">;
  isAdmin: boolean;
}> {
  const config = await readConfigInternal();
  const isAdmin = request
    ? await isAdminRequest(request, config.auth.passwordHash)
    : await isAdminSession(config.auth.passwordHash);
  return {
    config: {
      ...stripSecrets(stripAuth(config)),
      apps: visibleItems(config.apps, isAdmin),
      bookmarks: visibleItems(config.bookmarks, isAdmin),
    },
    isAdmin,
  };
}
