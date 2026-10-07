"use client";

import { useState, useSyncExternalStore } from "react";
import { type WebhookService } from "@/lib/schema";
import { Button, controlClasses, fieldLabelClasses } from "../ui";

// How each inbound-webhook service is named in its own app's UI, for the toggle
// and the "paste into …" hint (Seerr's payload comes from Overseerr/Jellyseerr).
export const WEBHOOK_LABELS: Record<WebhookService, string> = {
  sonarr: "Sonarr",
  radarr: "Radarr",
  seerr: "Overseerr / Jellyseerr",
};

// The visitor's origin without a set-state-in-effect: "" on the server and first
// paint (hydration-safe), the real origin once mounted — so the built URL is
// exact for wherever the admin is browsing without guessing the host server-side.
const subscribeNever = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => ""
  );
}

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
  const [copied, setCopied] = useState(false);
  const url = origin && token ? `${origin}/api/hooks/${service}?token=${token}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — the field is
      // selectable, so the admin can still copy by hand.
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <span className={fieldLabelClasses}>Webhook URL</span>
      <div className="flex items-center gap-2">
        <input
          readOnly
          aria-label={`${label} webhook URL`}
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${controlClasses} min-w-0 flex-1 font-mono text-xs`}
        />
        <Button variant="ghost" size="sm" type="button" onClick={copy} disabled={!url}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-fg/45">
          Paste into {label} → Settings → Connect → Webhook (method POST).
        </p>
        <Button variant="ghost" size="sm" type="button" onClick={onRegenerate}>
          Regenerate
        </Button>
      </div>
    </div>
  );
}
