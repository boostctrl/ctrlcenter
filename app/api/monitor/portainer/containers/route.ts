import { NextRequest, NextResponse } from "next/server";
import { requireAction } from "@/lib/services/guard";
import { listContainers } from "@/lib/services/portainer";
import { ServiceError } from "@/lib/services/http";
import { log, errorReason } from "@/lib/log";

// On-demand container list for one Portainer environment (#203). The snapshot
// stays environment-level (cheap 30s poll); the card fetches a single
// environment's containers here only when the admin expands it. Behind the same
// four gates as the write actions (requireAction) — it exposes container
// internals, so it belongs behind the allowActions opt-in too.
export async function GET(request: NextRequest) {
  const guard = await requireAction(request, "portainer");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const endpoint = Number(request.nextUrl.searchParams.get("endpoint"));
  if (!Number.isInteger(endpoint) || endpoint <= 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      containers: await listContainers(guard.cfg, endpoint),
    });
  } catch (e) {
    if (!(e instanceof ServiceError)) {
      log.warn("portainer containers error", { reason: errorReason(e) });
    }
    const reason = e instanceof ServiceError ? e.message : "Couldn’t list containers";
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
