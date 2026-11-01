"use client";

import { useState } from "react";
import { SECRET_PLACEHOLDER, type WebhookService } from "@/lib/schema";
import { Button } from "../ui";
import { CopyUrlField, useOrigin } from "../CopyUrlField";
import { fetchWithReauth } from "../reauth";
import { useToast } from "../Toast";
import { apiErrorMessage } from "../apiError";

// How each inbound-webhook service is named in its own app's UI, for the toggle
// and the "paste into …" hint. (Seerr is what Overseerr and Jellyseerr merged
// into; an install from before the merge sends the same payload.)
export const WEBHOOK_LABELS: Record<WebhookService, string> = {
  sonarr: "Sonarr",
  radarr: "Radarr",
  seerr: "Seerr",
};

// The read-only inbound-webhook URL for one service, with copy + regenerate.
// The settings the form holds carry a placeholder for the token (#382); the
// URL is completed on demand with a reveal that asks for the password.
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
  const toast = useToast();
  // The revealed token, remembered with the prop it stood in for: a
  // regenerated token arrives in full, and the old reveal no longer applies.
  const [revealed, setRevealed] = useState<{ of: string; token: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const revealedToken = revealed?.of === token ? revealed.token : null;
  const hidden = token === SECRET_PLACEHOLDER && revealedToken === null;
  const shown = token === SECRET_PLACEHOLDER ? (revealedToken ?? token) : token;
  const url = origin && shown ? `${origin}/api/hooks/${service}?token=${shown}` : "";
  async function reveal() {
    setRevealing(true);
    try {
      const res = await fetchWithReauth(`/api/hooks/token?service=${service}`);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't reveal the token"));
      setRevealed({ of: token, token: ((await res.json()) as { token: string }).token });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't reveal the token", "error");
    } finally {
      setRevealing(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <CopyUrlField label="Webhook URL" ariaLabel={`${label} webhook URL`} url={url} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-45">
          {hidden
            ? "The token is hidden; reveal it (asks for your password) or regenerate it, then paste into "
            : "Paste into "}
          {label} → Settings → Connect → Webhook (method POST).
        </p>
        <div className="flex shrink-0 gap-1">
          {hidden && (
            <Button variant="ghost" size="sm" type="button" onClick={reveal} disabled={revealing}>
              Reveal
            </Button>
          )}
          <Button variant="ghost" size="sm" type="button" onClick={onRegenerate}>
            Regenerate
          </Button>
        </div>
      </div>
    </div>
  );
}
