"use client";

import { type WebhookService } from "@/lib/schema";
import { Button } from "../ui";
import { CopyUrlField, useOrigin } from "../CopyUrlField";

// How each inbound-webhook service is named in its own app's UI, for the toggle
// and the "paste into …" hint (Seerr's payload comes from Overseerr/Jellyseerr).
export const WEBHOOK_LABELS: Record<WebhookService, string> = {
  sonarr: "Sonarr",
  radarr: "Radarr",
  seerr: "Overseerr / Jellyseerr",
};

// The read-only inbound-webhook URL for one service, with copy + regenerate.
export function WebhookUrlRow({
  service,
  label,
  token,
  onRegenerate,
}: {
  service: WebhookService;
  label: string;
  token: string;
  onRegenerate: () => void;
}) {
  const origin = useOrigin();
  const url = origin && token ? `${origin}/api/hooks/${service}?token=${token}` : "";
  return (
    <div className="flex flex-col gap-2">
      <CopyUrlField label="Webhook URL" ariaLabel={`${label} webhook URL`} url={url} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-45">
          Paste into {label} → Settings → Connect → Webhook (method POST).
        </p>
        <Button variant="ghost" size="sm" type="button" onClick={onRegenerate}>
          Regenerate
        </Button>
      </div>
    </div>
  );
}
