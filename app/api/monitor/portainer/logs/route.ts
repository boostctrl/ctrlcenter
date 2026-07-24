import { NextRequest, NextResponse } from "next/server";
import { requireAction } from "@/lib/services/guard";
import { containerLogs } from "@/lib/services/portainer";
import { ServiceError } from "@/lib/services/http";
import { log, errorReason } from "@/lib/log";

// Read-only, capped tail of one container's logs (#203). Behind the same four
// gates as the write actions (requireAction). Strictly read-only — this route
// only ever fetches the log tail; there is no exec, attach, or console path.
export async function GET(request: NextRequest) {
  const guard = await requireAction(request, "portainer");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const params = request.nextUrl.searchParams;
  const endpoint = Number(params.get("endpoint"));
  const container = params.get("container") ?? "";
  if (!Number.isInteger(endpoint) || endpoint <= 0 || container.trim() === "") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      logs: await containerLogs(guard.cfg, endpoint, container),
    });
  } catch (e) {
    if (!(e instanceof ServiceError)) {
      log.warn("portainer logs error", { reason: errorReason(e) });
    }
    const reason = e instanceof ServiceError ? e.message : "Couldn’t load logs";
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
