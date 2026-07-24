"use client";

import TestConnectionButton from "./TestConnectionButton";

type ChannelResult = { ok: boolean; detail: string };
type Result = { webhook?: ChannelResult; email?: ChannelResult };

// "Send test alert" button for the admin Alerts section: fires a synthetic down
// alert through the currently saved config so the admin can confirm the webhook
// and/or email channel actually delivers, rather than waiting for a real outage.
// Each channel's outcome is shown separately — the point is verifying each path.
// A thin adapter over TestConnectionButton; the parent computes which channels
// are configured (the button stays disabled until at least one is). Settings
// autosave, so the saved config this tests is effectively the current form.
export default function AlertTest({
  webhookConfigured,
  emailConfigured,
}: {
  webhookConfigured: boolean;
  emailConfigured: boolean;
}) {
  const configured = webhookConfigured || emailConfigured;

  return (
    <div className="flex flex-col gap-2">
      <TestConnectionButton<Result>
        endpoint="/api/alerts/test"
        label="Send test alert"
        pendingLabel="Sending…"
        disabled={!configured}
        renderResult={(data) => (
          <>
            {data.webhook && (
              <span
                className={`text-xs ${data.webhook.ok ? "text-emerald-400" : "text-red-400"}`}
              >
                {data.webhook.ok ? "✓" : "✗"} Webhook — {data.webhook.detail}
              </span>
            )}
            {data.email && (
              <span
                className={`text-xs ${data.email.ok ? "text-emerald-400" : "text-red-400"}`}
              >
                {data.email.ok ? "✓" : "✗"} Email — {data.email.detail}
              </span>
            )}
          </>
        )}
      />
      <p className="text-xs text-fg/40">
        Sends a test notification through the saved settings.
      </p>
    </div>
  );
}
