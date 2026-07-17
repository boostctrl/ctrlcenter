import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { loadHistory, setOutageNote, flush } from "@/lib/status-history";
import { outageNoteSchema } from "@/lib/schema";

// Write the admin's incident note onto one recorded outage (#176). The auth
// check lives in-route: /api/status/* must stay public for the status pages,
// so the proxy's path-prefix allowlist can't gate this endpoint — the same
// split as the icons API. Reads need no route of their own: notes ride the
// public detail payload, so a guest sees them exactly where they can see the
// app itself.
export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = outageNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await loadHistory();
  // Only a recorded outage can anchor a note — an approximate (pre-#175)
  // entry has no stable identity, so it 404s rather than half-working.
  if (!setOutageNote(id, parsed.data.start, parsed.data.note.trim())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await flush();
  return NextResponse.json({ ok: true });
}
