"use client";

import type { SampleId } from "@/lib/notification-samples";
import TestConnectionButton from "./TestConnectionButton";

type Result = { results: { id: string; label: string; ok: boolean; detail: string }[] };

// "Send test" for one alert channel (#291): fires a synthetic down alert
// through the saved config so the admin can confirm the channel actually
// delivers, rather than waiting for a real outage. With `sample`, it is the
// preview's "Send sample" (#347): one of the sample inbound-webhook events
// through the same route, with the saved report options. Settings autosave,
// so the saved config is the form, except while an edit is still saving; the
// button waits that out so it never tests the old values.
export default function AlertTest({
  channel,
  sample,
  ready,
  saving,
  ariaLabel,
}: {
  channel: string;
  sample?: SampleId;
  ready: boolean;
  saving: boolean;
  ariaLabel?: string;
}) {
  return (
    <TestConnectionButton<Result>
      endpoint="/api/alerts/test"
      body={sample ? { channel, sample } : { channel }}
      label={sample ? "Send sample" : "Send test"}
      ariaLabel={ariaLabel}
      pendingLabel="Sending…"
      disabled={!ready || saving}
      renderResult={(data) => {
        const r = data.results[0];
        if (!r) return <span className="text-xs text-status-down">✗ Not sent</span>;
        return (
          <span className={`text-xs ${r.ok ? "text-status-up" : "text-status-down"}`}>
            {r.ok ? "✓ Sent" : "✗ Failed"} ({r.detail})
          </span>
        );
      }}
    />
  );
}
