"use client";

import { useState, type ReactNode } from "react";
import { buttonClasses } from "@/lib/buttons";

// The shared "test/probe" button behind the admin's connection checks (#213):
// CalendarTest, FeedTest, AlertTest, and IntegrationTest all POST a probe
// endpoint, parse a JSON result, and render a ✓/✗ outcome. This owns the
// identical loading → fetch → parse → error state machine and the canonical
// ghost/sm button (so the corners follow the design's --control-radius token
// like every other button, per CLAUDE.md). Each caller supplies its endpoint,
// request body, labels, and a renderer that turns the successful response into
// its own ✓/✗ badges; an optional `renderExtra` renders a block beneath the row
// (the RSS probe's autodiscovered-feed picker). A transport failure — a network
// error or a non-2xx like an expired session's 401 — renders a standard ✗ badge
// so no probe ever fails silently.
export default function TestConnectionButton<T>({
  endpoint,
  body,
  label,
  pendingLabel,
  disabled = false,
  renderResult,
  renderExtra,
}: {
  endpoint: string;
  // Omit for a bodyless POST (the alert test fires through the saved config).
  body?: unknown;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
  renderResult: (data: T) => ReactNode;
  renderExtra?: (data: T) => ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data as { error?: string } | null)?.error ?? "Request failed");
      } else {
        setResult(data as T);
      }
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  const settled = !loading && error === null && result !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={loading || disabled}
          className={buttonClasses("ghost", "sm")}
        >
          {loading ? pendingLabel : label}
        </button>
        {!loading && error !== null && (
          <span className="text-xs text-red-400">✗ {error}</span>
        )}
        {settled && renderResult(result)}
      </div>
      {settled && renderExtra?.(result)}
    </div>
  );
}
