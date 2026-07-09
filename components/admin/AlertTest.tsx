"use client";

import { useState } from "react";

type ChannelResult = { ok: boolean; detail: string };
type Result = {
  loading: boolean;
  webhook?: ChannelResult;
  email?: ChannelResult;
  error?: string;
};

// "Send test alert" button for the admin Alerts section: fires a synthetic down
// alert through the currently saved config so the admin can confirm the webhook
// and/or email channel actually delivers, rather than waiting for a real outage.
// Each channel's outcome is shown separately — the point is verifying each path.
// Sibling of FeedTest; the parent computes which channels are configured (the
// button stays disabled until at least one is). Settings autosave, so the saved
// config this tests is effectively the current form.
export default function AlertTest({
  webhookConfigured,
  emailConfigured,
}: {
  webhookConfigured: boolean;
  emailConfigured: boolean;
}) {
  const [state, setState] = useState<Result>({ loading: false });
  const configured = webhookConfigured || emailConfigured;

  async function run() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/alerts/test", { method: "POST" });
      const data = await res.json().catch(() => null);
      // A failed request (e.g. an expired admin session's 401) must not render
      // as a silent no-result — surface it like a channel failure.
      if (!res.ok) {
        setState({ loading: false, error: data?.error ?? "Request failed" });
        return;
      }
      setState({ loading: false, webhook: data?.webhook, email: data?.email });
    } catch {
      setState({ loading: false, error: "Request failed" });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={state.loading || !configured}
          className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
        >
          {state.loading ? "Sending…" : "Send test alert"}
        </button>
        {!state.loading && state.webhook && (
          <span
            className={`text-xs ${state.webhook.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {state.webhook.ok ? "✓" : "✗"} Webhook — {state.webhook.detail}
          </span>
        )}
        {!state.loading && state.email && (
          <span
            className={`text-xs ${state.email.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {state.email.ok ? "✓" : "✗"} Email — {state.email.detail}
          </span>
        )}
        {!state.loading && state.error && (
          <span className="text-xs text-red-400">✗ {state.error}</span>
        )}
      </div>
      <p className="text-xs text-fg/40">
        Sends a test notification through the saved settings.
      </p>
    </div>
  );
}
