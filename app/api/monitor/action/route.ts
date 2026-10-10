import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAction } from "@/lib/services/guard";
import { invalidateService } from "@/lib/monitor";
import type { ResolvedIntegration } from "@/lib/services/resolve";
import { pauseTorrent, resumeTorrent, deleteTorrent } from "@/lib/services/qbittorrent";
import { approveRequest, declineRequest } from "@/lib/services/seerr";
import { startContainer, stopContainer, restartContainer } from "@/lib/services/portainer";
import { ServiceError } from "@/lib/services/http";
import { log, hostOf, errorReason } from "@/lib/log";

// The write-action data plane for the Monitor page (#201/#202/#203): one POST
// dispatcher for every state-changing integration action. Admin-only twice over
// like the read routes (proxy prefix + the session re-check inside
// requireAction), plus the two write-only gates — the integration must be
// configured and have actions explicitly turned on (lib/services/guard.ts).
//
// The body names the integration (#300) and is a per-type discriminated
// union on `service`: distinct param shapes and verbs, so an explicit switch
// is clearer and more type-safe than a generic registry (unlike the uniform
// probes in /api/monitor/test). The guard only resolves an integration of the
// named type. Each action is logged host-only via lib/log.ts; credentials
// never appear.

const integration = z.string().min(1).max(64);
const bodySchema = z.discriminatedUnion("service", [
  z.object({
    integration,
    service: z.literal("qbittorrent"),
    action: z.enum(["pause", "resume", "delete"]),
    hash: z.string().min(1),
    // Only meaningful for delete; ignored otherwise. Defaults to keeping data.
    deleteFiles: z.boolean().optional(),
  }),
  z.object({
    integration,
    service: z.literal("seerr"),
    action: z.enum(["approve", "decline"]),
    id: z.number().int().nonnegative(),
  }),
  z.object({
    integration,
    service: z.literal("portainer"),
    action: z.enum(["start", "stop", "restart"]),
    endpoint: z.number().int().positive(),
    container: z.string().min(1),
  }),
]);

type ActionBody = z.infer<typeof bodySchema>;

// Run one validated action with the integration's resolved credentials (the
// guard only resolved one of `body.service`'s type).
async function perform(body: ActionBody, c: ResolvedIntegration): Promise<void> {
  switch (body.service) {
    case "qbittorrent": {
      if (body.action === "pause") return pauseTorrent(c, body.hash);
      if (body.action === "resume") return resumeTorrent(c, body.hash);
      return deleteTorrent(c, body.hash, body.deleteFiles ?? false);
    }
    case "seerr": {
      if (body.action === "approve") return approveRequest(c, body.id);
      return declineRequest(c, body.id);
    }
    case "portainer": {
      if (body.action === "start")
        return startContainer(c, body.endpoint, body.container);
      if (body.action === "stop")
        return stopContainer(c, body.endpoint, body.container);
      return restartContainer(c, body.endpoint, body.container);
    }
  }
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const body = parsed.data;

  const guard = await requireAction(request, body.integration, body.service);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    await perform(body, guard.cfg);
  } catch (e) {
    // A ServiceError's message is written for the admin's eyes (short, no
    // internals); anything else is logged host-only and reported generically.
    if (!(e instanceof ServiceError)) {
      log.warn("integration action error", {
        integration: body.integration,
        service: body.service,
        action: body.action,
        reason: errorReason(e),
      });
    }
    const reason = e instanceof ServiceError ? e.message : "Action failed";
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  // Drop the cached snapshot so the card's refetch reflects the action at once
  // instead of serving stale data until the TTL lapses.
  invalidateService(body.integration);

  log.info("integration action", {
    integration: body.integration,
    service: body.service,
    action: body.action,
    host: hostOf(guard.cfg.url),
  });
  return NextResponse.json({ ok: true });
}
