"use client";

import { useState } from "react";

type Result = { loading: boolean; ok?: boolean; detail?: string; error?: string };

// "Test connection" button for an Integrations card: probes the values
// currently in the form (before saving) via the admin-only
// /api/monitor/test route, and names what answered ("qBittorrent v5.0.1")
// so the admin knows the right service is on the other end. CalendarTest's
// sibling.
export default function IntegrationTest({
  service,
  url,
  username,
  password,
  apiKey,
}: {
  service: "qbittorrent" | "sonarr" | "radarr";
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
}) {
  const [state, setState] = useState<Result>({ loading: false });

  async function run() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/monitor/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, url, username, password, apiKey }),
      });
      const data = await res.json().catch(() => null);
      setState({
        loading: false,
        ok: data?.ok,
        detail: data?.detail,
        error: data?.error,
      });
    } catch {
      setState({ loading: false, ok: false, error: "Request failed" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state.loading || url.trim() === ""}
        className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
      >
        {state.loading ? "Testing…" : "Test connection"}
      </button>
      {!state.loading && state.ok === true && (
        <span className="text-xs text-emerald-400">
          ✓ Connected{state.detail ? ` — ${state.detail}` : ""}
        </span>
      )}
      {!state.loading && state.ok === false && (
        <span className="text-xs text-red-400">✗ {state.error}</span>
      )}
    </div>
  );
}
