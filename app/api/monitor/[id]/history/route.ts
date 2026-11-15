import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { historyOf, loadHistory } from "@/lib/monitor-history";

// One integration's recorded history for its page's charts and the command
// deck's trends (#530): the last hour minute by minute, or the last day in
// 15-minute steps. Admin-only twice over, like the rest of /api/monitor.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!config.integrations.some((i) => i.id === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const range = request.nextUrl.searchParams.get("range") === "day" ? "day" : "hour";
  await loadHistory();
  return NextResponse.json(historyOf(id, range));
}
