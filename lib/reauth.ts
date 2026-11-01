import { NextResponse, type NextRequest } from "next/server";
import { viewerOf } from "./api-auth";
import type { AuthConfig } from "./schema/auth";

// Step-up re-authentication (#366). A signed-in session is enough for
// ordinary admin work, but the actions a stolen session could do the most
// harm with — changing the password, turning the second factor off,
// re-pointing where a credential is sent (an integration; an API widget, a
// calendar or an email channel's server, see lib/reauth-targets.ts, #378),
// exporting secrets, restoring a backup, the destructive dashboard actions —
// also need the credentials to have been
// re-proved recently: at sign-in, or through POST /api/reauth since. The
// admin UI answers the 403 below with a "Confirm it's you" dialog and
// retries.
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

export type RecentAuth =
  | { ok: true; sessionId: string }
  | { ok: false; response: NextResponse };

// Whether the request's session proved its credentials within the window.
// No live session → 401; one whose proof is stale → 403 with
// `reauthRequired`, the signal the UI acts on. Any account's session counts
// (#423): a member confirms its own password for its own changes, and the
// admin-only routes check the role before they get here. `auth` is the
// fast path callers that already read the config take (see isAdminRequest).
export async function requireRecentAuth(
  request: NextRequest,
  auth?: AuthConfig,
  now = Date.now()
): Promise<RecentAuth> {
  const viewer = await viewerOf(request, auth);
  if (!viewer) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { session } = viewer;
  const sessionId = session.id;
  if (now - session.reauthAt > REAUTH_WINDOW_MS) {
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
