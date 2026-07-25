// Inbound webhook payload parsers (#204). Sonarr/Radarr/Overseerr(Seerr) POST an
// event to /api/hooks/<service>; these pure functions fold each app's payload
// into a short { title, body } the alert channels relay (lib/alerts.ts
// sendNotification). Parsing is lenient — the apps let the admin choose which
// triggers fire, and payload shapes drift across versions, so a recognized event
// gets a tidy line and anything else falls back to a generic "<App>: <event>"
// rather than being dropped. Unit-tested directly (no IO here).

import type { WebhookService } from "./schema";

export type WebhookNotification = {
  // One-line headline (the ntfy/email subject and the bolded lead).
  title: string;
  // Optional detail under the title.
  body?: string;
  // Optional link, when the payload carries one.
  url?: string;
};

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

// "GrabbedFromInteractiveSearch" → "Grabbed from interactive search". A last
// resort for event types we don't special-case, so nothing goes unlabeled.
function humanize(s: string): string {
  const spaced = s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1).toLowerCase() : s;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// --- Sonarr / Radarr (shared `eventType` shape) ---

// "The Bear – S04E03" (Sonarr) or "Dune: Part Three (2024)" (Radarr), best-effort.
function arrSubject(service: "sonarr" | "radarr", p: Record<string, unknown>): string {
  if (service === "radarr") {
    const movie = asRecord(p.movie);
    const title = str(movie.title) || str(asRecord(p.remoteMovie).title);
    const year = typeof movie.year === "number" ? ` (${movie.year})` : "";
    return title ? `${title}${year}` : "";
  }
  const series = str(asRecord(p.series).title);
  const eps = Array.isArray(p.episodes) ? p.episodes : [];
  const codes = eps
    .map((e) => {
      const ep = asRecord(e);
      const s = ep.seasonNumber;
      const n = ep.episodeNumber;
      return typeof s === "number" && typeof n === "number"
        ? `S${pad2(s)}E${pad2(n)}`
        : "";
    })
    .filter(Boolean);
  if (!series) return codes.join(", ");
  return codes.length ? `${series} – ${codes.join(", ")}` : series;
}

export function parseArrWebhook(
  service: "sonarr" | "radarr",
  payload: unknown
): WebhookNotification | null {
  const p = asRecord(payload);
  const eventType = str(p.eventType);
  if (!eventType) return null;
  const app = service === "sonarr" ? "Sonarr" : "Radarr";
  const subject = arrSubject(service, p);
  const quality = str(asRecord(p.release).quality);

  switch (eventType) {
    case "Test":
      return {
        title: `${app} webhook test`,
        body: "Inbound webhooks are working.",
      };
    case "Grab":
      return {
        title: `${app} grabbed ${subject || "a release"}`,
        body: quality || undefined,
      };
    case "Download":
      return {
        title: `${app} imported ${subject || "a download"}`,
        body: p.isUpgrade === true ? "Upgrade of an existing file" : undefined,
      };
    case "DownloadFailed":
      return { title: `${app} download failed`, body: subject || undefined };
    case "ManualInteractionRequired":
      return {
        title: `${app} needs manual interaction`,
        body: subject || undefined,
      };
    case "Health":
    case "HealthIssue": {
      const level = str(p.level) || "issue";
      return {
        title: `${app} health ${level}`,
        body: str(p.message) || undefined,
      };
    }
    case "HealthRestored":
      return {
        title: `${app} health restored`,
        body: str(p.message) || undefined,
      };
    case "ApplicationUpdate":
      return {
        title: `${app} updated`,
        body: str(p.message) || undefined,
      };
    default:
      return {
        title: `${app}: ${humanize(eventType)}`,
        body: subject || undefined,
      };
  }
}

// --- Overseerr / Jellyseerr (Seerr), keyed by `notification_type` ---

const SEERR_LABELS: Record<string, string> = {
  TEST_NOTIFICATION: "webhook test",
  MEDIA_PENDING: "new request needs approval",
  MEDIA_APPROVED: "request approved",
  MEDIA_AUTO_APPROVED: "request auto-approved",
  MEDIA_AVAILABLE: "now available",
  MEDIA_DECLINED: "request declined",
  MEDIA_FAILED: "request failed",
  ISSUE_CREATED: "new issue reported",
  ISSUE_COMMENT: "new issue comment",
  ISSUE_RESOLVED: "issue resolved",
  ISSUE_REOPENED: "issue reopened",
};

export function parseSeerrWebhook(payload: unknown): WebhookNotification | null {
  const p = asRecord(payload);
  const nt = str(p.notification_type);
  if (!nt) return null;
  if (nt === "TEST_NOTIFICATION") {
    return { title: "Seerr webhook test", body: "Inbound webhooks are working." };
  }
  const label = SEERR_LABELS[nt] ?? humanize(nt);
  const subject = str(p.subject);
  return {
    title: subject ? `Seerr — ${label}: ${subject}` : `Seerr — ${label}`,
    body: str(p.message) || undefined,
  };
}

// Dispatch to the right parser for the addressed service.
export function parseWebhook(
  service: WebhookService,
  payload: unknown
): WebhookNotification | null {
  return service === "seerr"
    ? parseSeerrWebhook(payload)
    : parseArrWebhook(service, payload);
}
