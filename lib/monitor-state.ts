// The states an integration's tile can be in (#208), derived from its status.
// Plain code shared by the Monitor's client components and the board tiles
// built on the server (#301).
import type { ServiceStatus } from "./monitor";

// live         — fresh data, no trouble
// stale        — last-good data while a refresh is failing
// unreachable  — configured but never answered (calm offline, not a red mess)
// disabled     — has a URL but the enable toggle is off (off, not broken)
// unconfigured — no URL yet (an inviting onboarding tile)
export type ServiceState = "live" | "stale" | "unreachable" | "disabled" | "unconfigured";

export function serviceState(
  status: Pick<ServiceStatus<unknown>, "configured" | "enabled" | "urlSet" | "data" | "error">
): ServiceState {
  if (status.data) return status.error ? "stale" : "live";
  if (status.configured) return "unreachable";
  // Not configured: a URL with the toggle off is a deliberate "off"; no URL is
  // simply not set up yet (this also folds in enabled-but-URL-blank half-setups).
  return status.urlSet && !status.enabled ? "disabled" : "unconfigured";
}
