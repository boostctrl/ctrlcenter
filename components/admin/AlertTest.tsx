"use client";

import TestConnectionButton from "./TestConnectionButton";

type Result = { results: { id: string; label: string; ok: boolean; detail: string }[] };

// "Send test" for one alert channel (#291): fires a synthetic down alert
// through the saved config so the admin can confirm the channel actually
// delivers, rather than waiting for a real outage. Settings autosave, so the
// saved config is the form, except while an edit is still saving; the button
// waits that out so it never tests the old values.
export default function AlertTest({
  channel,
  ready,
  saving,
}: {
  channel: string;
  ready: boolean;
  saving: boolean;
}) {
  return (
    <TestConnectionButton<Result>
      endpoint="/api/alerts/test"
      body={{ channel }}
      label="Send test"
      pendingLabel="Sending…"
      disabled={!ready || saving}
      renderResult={(data) => {
        const r = data.results[0];
        if (!r) return <span className="text-xs text-red-400">✗ Not sent</span>;
        return (
          <span className={`text-xs ${r.ok ? "text-emerald-400" : "text-red-400"}`}>
            {r.ok ? "✓ Sent" : "✗ Failed"} ({r.detail})
          </span>
        );
      }}
    />
  );
}
