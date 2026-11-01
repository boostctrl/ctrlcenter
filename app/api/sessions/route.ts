import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, viewerOf } from "@/lib/api-auth";
import { sessionSettingsSchema } from "@/lib/schema";
import { getIdleHours, listSessions, sessionAccount, setIdleHours } from "@/lib/sessions";
import { requireRecentAuth } from "@/lib/reauth";

// Admin-only (gated by the /api/sessions proxy prefix and re-checked here).
// The active admin sessions (#365): GET lists them, newest activity first,
// with the caller's own marked, plus the idle timeout; PATCH sets the idle
// timeout. Ending sessions is the [id] and others routes.
export async function GET(request: NextRequest) {
  const viewer = await viewerOf(request);
  if (!viewer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // An admin sees every session; a member only its own (#423).
  const current = viewer.session.id;
  const sessions = (await listSessions())
    .filter((s) => viewer.isAdmin || sessionAccount(s) === viewer.account.id)
    .map((s) => ({ ...s, current: s.id === current }));
  return NextResponse.json({ idleHours: await getIdleHours(), sessions });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = sessionSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  // Lengthening the timeout extends how long a stolen session would live:
  // that takes a recent confirmation (#382). Shortening it never does.
  if (parsed.data.idleHours > (await getIdleHours())) {
    const recent = await requireRecentAuth(request);
    if (!recent.ok) return recent.response;
  }
  const idleHours = await setIdleHours(parsed.data.idleHours);
  return NextResponse.json({ idleHours });
}
