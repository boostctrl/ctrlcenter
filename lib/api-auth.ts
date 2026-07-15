import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
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
// Callers that already hold the config pass `passwordHash` so the check doesn't
// read and parse config.yaml a second time in the same request — the status
// APIs are polled by every open dashboard tab, so the double read adds up.
export async function isAdminRequest(
  request: NextRequest,
  passwordHash?: string
): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hash = passwordHash ?? (await readConfigInternal()).auth.passwordHash;
  return verifySessionToken(token, hash);
}

// Same check for server components (no NextRequest there — the cookie comes
// from next/headers). Lets a page decide whether to offer admin affordances
// like the home-page layout editor; the APIs those affordances call are still
// gated by the proxy, so this is presentation-only trust. Same optional
// `passwordHash` fast path as isAdminRequest.
export async function isAdminSession(passwordHash?: string): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const hash = passwordHash ?? (await readConfigInternal()).auth.passwordHash;
  return verifySessionToken(token, hash);
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
