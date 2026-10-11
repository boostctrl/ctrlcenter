import { NextResponse, type NextRequest } from "next/server";
import { adminSessionId } from "./api-auth";
import { getSession } from "./sessions";

// Step-up re-authentication (#366). A signed-in session is enough for
// ordinary admin work, but the actions a stolen session could do the most
// harm with — changing the password, turning the second factor off, editing
// integration credentials, exporting secrets, restoring a backup, the
// destructive dashboard actions — also need the credentials to have been
// re-proved recently: at sign-in, or through POST /api/reauth since. The
// admin UI answers the 403 below with a "Confirm it's you" dialog and
// retries.
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

export type RecentAuth =
  | { ok: true; sessionId: string }
  | { ok: false; response: NextResponse };

// Whether the request's session proved its credentials within the window.
// Not an admin at all → 401; an admin whose proof is stale → 403 with
// `reauthRequired`, the signal the UI acts on. `passwordHash` is the fast
// path callers that already read the config take (see isAdminRequest).
export async function requireRecentAuth(
  request: NextRequest,
  passwordHash?: string,
  now = Date.now()
): Promise<RecentAuth> {
  const sessionId = await adminSessionId(request, passwordHash);
  if (!sessionId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const session = await getSession(sessionId, now);
  if (!session || now - session.reauthAt > REAUTH_WINDOW_MS) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Confirm it's you to continue", reauthRequired: true },
        { status: 403 }
      ),
    };
  }
  return { ok: true, sessionId };
}
