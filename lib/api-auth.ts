import type { NextRequest } from "next/server";
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
