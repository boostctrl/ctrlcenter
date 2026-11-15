// The Monitor's shared read of an integration's state (#207): which of the
// five it's in (lib/monitor-state.ts), the dot that stands for each, and how
// long ago its data came back.
//   live         — data fresh from the last refresh
//   stale        — last-good data while a refresh is failing
//   unreachable  — configured but never answered (calm offline, not a red mess)
//   disabled     — has a URL but the enable toggle is off (off, not broken)
//   unconfigured — no URL yet (an inviting onboarding tile)
import type { ServiceState } from "@/lib/monitor-state";
export { serviceState, type ServiceState } from "@/lib/monitor-state";

// The dot's tone per state — the at-a-glance health read, shared by the
// tiles, the health banner and the integration pages' status pill, so a dot
// means the same thing everywhere.
export const STATE_DOT: Record<ServiceState, string> = {
  live: "bg-status-up",
  stale: "bg-status-warning",
  unreachable: "bg-status-down",
  disabled: "bg-fg/25",
  unconfigured: "border border-dashed border-fg/30",
};

// Compact "time since" for the freshness reads shared by the cockpit header and
// the detail masthead — how long ago the shown data last came back. Under five
// seconds reads "just now" so a fresh poll doesn't flicker "0s ago".
export function sinceLabel(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}
