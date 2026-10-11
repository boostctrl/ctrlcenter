import { NextRequest, NextResponse } from "next/server";
import { adminSessionId, isAdminRequest } from "@/lib/api-auth";
import { sessionSettingsSchema } from "@/lib/schema";
import { getIdleHours, listSessions, setIdleHours } from "@/lib/sessions";

// Admin-only (gated by the /api/sessions proxy prefix and re-checked here).
// The active admin sessions (#365): GET lists them, newest activity first,
// with the caller's own marked, plus the idle timeout; PATCH sets the idle
// timeout. Ending sessions is the [id] and others routes.
export async function GET(request: NextRequest) {
  const current = await adminSessionId(request);
  if (!current) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sessions = (await listSessions()).map((s) => ({ ...s, current: s.id === current }));
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
  const idleHours = await setIdleHours(parsed.data.idleHours);
  return NextResponse.json({ idleHours });
}
