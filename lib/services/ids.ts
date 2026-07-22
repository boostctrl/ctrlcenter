// The catalog of integration services — just the ids and display labels, safe
// to import from client components (no clients, no credentials, no node-only
// code). The server half lives in ./registry.ts, keyed by the same ids.
//
// Adding a service (#212): add its id here and TypeScript walks you through
// the rest — the registry (lib/services/registry.ts), the config schema
// (integrationsSchema in lib/schema.ts), and the card map (MonitorDashboard)
// are all typed as complete records over ServiceId, so a forgotten entry is a
// compile error rather than a configured service that silently never polls or
// renders.

export const SERVICE_IDS = [
  "qbittorrent",
  "sonarr",
  "radarr",
  "adguard",
  "tautulli",
  "overseerr",
  "portainer",
  "truenas",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const SERVICE_LABELS: Record<ServiceId, string> = {
  qbittorrent: "qBittorrent",
  sonarr: "Sonarr",
  radarr: "Radarr",
  adguard: "AdGuard Home",
  tautulli: "Tautulli",
  overseerr: "Overseerr",
  portainer: "Portainer",
  truenas: "TrueNAS",
};
