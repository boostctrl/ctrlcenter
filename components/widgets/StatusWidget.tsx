import { StatusSummary } from "../StatusProvider";

// A standalone service-health card — the header card's status row on its own
// glass surface. StatusSummary renders nothing until the first poll resolves,
// so the widget never flashes an empty card.
export default function StatusWidget({
  statusEnabled,
  apps,
}: {
  statusEnabled: boolean;
  apps: { id: string; name: string }[];
}) {
  if (!statusEnabled) return null;
  return <StatusSummary apps={apps} variant="card" />;
}
