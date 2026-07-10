import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth";
import { readConfig } from "./config";

// Route-level admin check for endpoints the proxy's path-prefix allowlist can't
// gate. The icons API is the case: individual icons (GET /api/icons/[name]) must
// be public because they render on the unauthenticated dashboard, while listing,
// uploading, and deleting (the /api/icons collection) must be admin-only — so a
// single prefix in the proxy can't express it. Mirrors the proxy's verification
// (token signed against the current password hash, so a password change revokes
// outstanding sessions).
export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { auth } = await readConfig();
  return verifySessionToken(token, auth.passwordHash);
}

// Same check for server components (no NextRequest there — the cookie comes
// from next/headers). Lets a page decide whether to offer admin affordances
// like the home-page layout editor; the APIs those affordances call are still
// gated by the proxy, so this is presentation-only trust.
export async function isAdminSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const { auth } = await readConfig();
  return verifySessionToken(token, auth.passwordHash);
}

// Apps flagged `private` exist only for the admin session. This is the single
// filter every public surface applies before app names/URLs leave the server —
// the home page, /status, and the status APIs. The background poller, history
// recording, and alerts deliberately bypass it: a private service should still
// be monitored, it just shouldn't render for guests.
export function visibleApps<T extends { private: boolean }>(
  apps: T[],
  isAdmin: boolean
): T[] {
  return isAdmin ? apps : apps.filter((a) => !a.private);
}
