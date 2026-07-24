import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAction } from "@/lib/services/guard";
import type { IntegrationsConfig } from "@/lib/schema";
import {
  pauseTorrent,
  resumeTorrent,
  deleteTorrent,
  type QbittorrentConfig,
} from "@/lib/services/qbittorrent";
import { ServiceError } from "@/lib/services/http";
import { log, hostOf, errorReason } from "@/lib/log";

// The write-action data plane for the Monitor page (#201/#202/#203): one POST
// dispatcher for every state-changing integration action. Admin-only twice over
// like the read routes (proxy prefix + the session re-check inside
// requireAction), plus the two write-only gates — the integration must be
// configured and have actions explicitly turned on (lib/services/guard.ts).
//
// The body is a per-service discriminated union: distinct param shapes and
// verbs, so an explicit switch is clearer and more type-safe than a generic
// registry (unlike the uniform probes in /api/monitor/test). Each action is
// logged host-only via lib/log.ts; credentials never appear.

const bodySchema = z.discriminatedUnion("service", [
  z.object({
    service: z.literal("qbittorrent"),
    action: z.enum(["pause", "resume", "delete"]),
    hash: z.string().min(1),
    // Only meaningful for delete; ignored otherwise. Defaults to keeping data.
    deleteFiles: z.boolean().optional(),
  }),
]);

type ActionBody = z.infer<typeof bodySchema>;

// Run one validated action against its resolved config. `cfg` is the config
// slice the guard fetched for `body.service`; TypeScript can't correlate the
// two across parameters, so each branch narrows it to the slice it knows is
// present by construction (the guard read integrations[body.service]).
async function perform(
  body: ActionBody,
  cfg: IntegrationsConfig[ActionBody["service"]]
): Promise<void> {
  switch (body.service) {
    case "qbittorrent": {
      const c = cfg as QbittorrentConfig;
      if (body.action === "pause") return pauseTorrent(c, body.hash);
      if (body.action === "resume") return resumeTorrent(c, body.hash);
      return deleteTorrent(c, body.hash, body.deleteFiles ?? false);
    }
  }
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const body = parsed.data;

  const guard = await requireAction(request, body.service);
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
        service: body.service,
        action: body.action,
        reason: errorReason(e),
      });
    }
    const reason = e instanceof ServiceError ? e.message : "Action failed";
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  log.info("integration action", {
    service: body.service,
    action: body.action,
    host: hostOf(guard.cfg.url),
  });
  return NextResponse.json({ ok: true });
}
