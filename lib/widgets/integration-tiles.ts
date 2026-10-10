// Board tiles for integrations (#301): the same tile the Monitor shows,
// built on the server so a board page never receives a service's snapshot,
// only the finished tile. A tile set to "Everyone" is built from the type's
// public view (counts and states, components/monitor/glances.ts); one left at
// "Only me" never reaches a signed-out visitor at all.
import type { InstanceOf, Integration } from "../schema";
import { getMonitorSnapshot } from "../monitor";
import { integrationLabels } from "../services/ids";
import { tileContent, type TileContent } from "@/components/monitor/glances";

export type IntegrationTile = TileContent & {
  // The integration's name, as the Monitor and admin call it.
  label: string;
  // Its Monitor detail page, for the admin only.
  href?: string;
};

// Whether a signed-out visitor may receive this widget at all.
export const shownToGuests = (w: InstanceOf<"integration">): boolean => w.visibility === "public";

export async function integrationTiles(
  widgets: InstanceOf<"integration">[],
  integrations: Integration[],
  { isAdmin, now }: { isAdmin: boolean; now: number }
): Promise<Record<string, IntegrationTile>> {
  const visible = widgets.filter((w) => isAdmin || shownToGuests(w));
  const wanted = new Set(visible.map((w) => w.integration));
  const targets = integrations.filter((i) => wanted.has(i.id));
  if (targets.length === 0) return {};
  // Through the Monitor's shared cache, so a board and the Monitor cost the
  // service one fetch per window between them. Labels come from the whole
  // list, so "Sonarr 2" reads the same here as on the Monitor.
  const entries = await getMonitorSnapshot(targets);
  const labels = integrationLabels(integrations);
  const out: Record<string, IntegrationTile> = {};
  for (const w of visible) {
    const entry = entries.find((e) => e.id === w.integration);
    if (!entry) continue;
    out[w.id] = {
      ...tileContent(entry, now, w.visibility === "public" ? "public" : "admin"),
      label: labels[entry.id],
      ...(isAdmin ? { href: `/admin/monitor/${encodeURIComponent(entry.id)}` } : {}),
    };
  }
  return out;
}
