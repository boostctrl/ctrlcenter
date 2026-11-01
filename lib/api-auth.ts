import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionTokenFrom, verifySession, type LiveSession } from "./auth";
import { isAdminAccount } from "./accounts";
import { watchSessionAddress } from "./session-watch";
import { readConfigInternal, stripAuth, stripSecrets } from "./config";
import type { AuthConfig, Config } from "./schema";

// Who is asking (#423): the live session and its account, and whether that
// account may act as an admin. The one resolver behind every admin check
// below, so a request is judged the same way everywhere.
export type Viewer = LiveSession & { isAdmin: boolean };

const authOf = async (auth?: AuthConfig) => auth ?? (await readConfigInternal()).auth;

// The viewer behind a route-handler request, or null when it carries no
// live session. Mirrors the proxy's verification (a token signed against its
// account's password hash, so a password change revokes that account's
// sessions). Writes (any non-GET/HEAD/OPTIONS method) must also pass the
// same-origin check below, so a valid cookie alone can't authorize a
// cross-site request. Callers that already hold the config pass `auth` so
// the check doesn't read and parse config.yaml a second time in the same
// request — the status APIs are polled by every open dashboard tab, so the
// double read adds up.
export async function viewerOf(request: NextRequest, auth?: AuthConfig): Promise<Viewer | null> {
  if (!isSafeMethod(request.method) && !isSameOriginRequest(request)) return null;
  const live = await verifySession(sessionTokenFrom(request.cookies), await authOf(auth));
  if (!live) return null;
  // A session used from a new address announces itself once (#382).
  await watchSessionAddress(request, live.session);
  return { ...live, isAdmin: isAdminAccount(live.account) };
}

// The same for server components (no NextRequest there — the cookie comes
// from next/headers). Presentation-only trust: the APIs a page's affordances
// call re-check the session themselves.
export async function viewerFromCookies(auth?: AuthConfig): Promise<Viewer | null> {
  const live = await verifySession(sessionTokenFrom(await cookies()), await authOf(auth));
  return live ? { ...live, isAdmin: isAdminAccount(live.account) } : null;
}

// Route-level admin check for endpoints the proxy's path-prefix allowlist can't
// gate. The icons API is the case: individual icons (GET /api/icons/[name]) must
// be public because they render on the unauthenticated dashboard, while listing,
// uploading, and deleting (the /api/icons collection) must be admin-only — so a
// single prefix in the proxy can't express it.
export async function isAdminRequest(request: NextRequest, auth?: AuthConfig): Promise<boolean> {
  return (await viewerOf(request, auth))?.isAdmin === true;
}

// The same check, answering with the session's id (null when not an admin
// request) for the routes that act on the current session: logout, the
// active-sessions list, "sign out everywhere else" (#365).
export async function adminSessionId(request: NextRequest, auth?: AuthConfig): Promise<string | null> {
  const viewer = await viewerOf(request, auth);
  return viewer?.isAdmin ? viewer.session.id : null;
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

// Whether a server component's viewer is an admin. Lets a page decide
// whether to offer admin affordances like the home-page layout editor. Same
// optional `auth` fast path as isAdminRequest.
export async function isAdminSession(auth?: AuthConfig): Promise<boolean> {
  return (await viewerFromCookies(auth))?.isAdmin === true;
}

// Page-level gate for everything under /admin (except the login page itself).
// The proxy already redirects signed-out visitors, but a page that renders
// secrets (the admin portal hands the full settings to its client tree) must
// not depend on the proxy alone: a proxy bypass would otherwise serve them.
// Redirects exactly like the proxy does, so the login page sends the admin
// back here afterwards.
export async function requireAdminPage(next: string, auth?: AuthConfig): Promise<void> {
  if (await isAdminSession(auth)) return;
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
// filter: the object returned is safe to serialize to a client component —
// all but the widget instances, whose content is what the server fetches with
// (a calendar's address, feed URLs, disk paths, an API widget's request): a
// page hands those over only as each widget's public shape
// (lib/widgets/public.ts, #380). Route handlers pass their NextRequest (the
// isAdminRequest path); server components omit it (the isAdminSession path).
// Surfaces that genuinely need the full list or the real secrets — the poller,
// alerts, the calendar fetch (getCalendarAuth), admin routes — use
// readConfigInternal, and a test pins which files under app/ may do so.
// Whether this request comes from the signed-in admin, for server pages that
// read the full config themselves (the calendar page needs its credentials).
export async function viewerIsAdmin(): Promise<boolean> {
  return isAdminSession((await readConfigInternal()).auth);
}

export async function readPublicConfig(request?: NextRequest): Promise<{
  config: Omit<Config, "auth">;
  isAdmin: boolean;
}> {
  const config = await readConfigInternal();
  const isAdmin = request ? await isAdminRequest(request, config.auth) : await isAdminSession(config.auth);
  const safe = stripSecrets(stripAuth(config));
  const apps = visibleItems(safe.apps, isAdmin);
  const bookmarks = visibleItems(safe.bookmarks, isAdmin);
  // A guest gets only the groups their apps and bookmarks belong to (#299),
  // so a group holding only private items doesn't give its name away.
  const used = new Set([...apps, ...bookmarks].map((i) => i.group));
  return {
    config: {
      ...safe,
      apps,
      bookmarks,
      groups: isAdmin ? safe.groups : safe.groups.filter((g) => used.has(g.id)),
    },
    isAdmin,
  };
}
