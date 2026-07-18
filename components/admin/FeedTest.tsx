"use client";

import { useState } from "react";

type Result = {
  loading: boolean;
  ok?: boolean;
  count?: number;
  title?: string;
  error?: string;
  discovered?: string[];
};

// "Test feed" button for the admin RSS section: probes the current URL so the
// admin can confirm the feed is readable (and see its title / entry count)
// rather than guessing why the home card is empty. When the URL is a web page
// rather than a feed, the probe autodiscovers the site's feed link(s) and
// offers them as one-click fills (via onPick). Sibling of CalendarTest.
export default function FeedTest({
  url,
  onPick,
}: {
  url: string;
  onPick?: (url: string) => void;
}) {
  const [state, setState] = useState<Result>({ loading: false });

  async function run() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/feed/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => null);
      setState({
        loading: false,
        ok: data?.ok,
        count: data?.count,
        title: data?.title,
        error: data?.error,
        discovered: data?.discovered,
      });
    } catch {
      setState({ loading: false, ok: false, error: "Request failed" });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={state.loading || url.trim() === ""}
          className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
        >
          {state.loading ? "Testing…" : "Test feed"}
        </button>
        {!state.loading && state.ok === true && (
          <span className="text-xs text-emerald-400">
            ✓ {state.title ? `“${state.title}”` : "Readable"} — {state.count}{" "}
            entr{state.count === 1 ? "y" : "ies"}
          </span>
        )}
        {!state.loading && state.ok === false && (
          <span className="text-xs text-red-400">✗ {state.error}</span>
        )}
      </div>
      {!state.loading && state.discovered && state.discovered.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-fg/45">
            {state.discovered.length === 1 ? "Found a feed" : "Found feeds"} —
            use{state.discovered.length === 1 ? " it" : " one"}:
          </span>
          <div className="flex flex-wrap gap-2">
            {state.discovered.map((feedUrl) => (
              <button
                key={feedUrl}
                type="button"
                onClick={() => onPick?.(feedUrl)}
                disabled={!onPick}
                className="max-w-full truncate rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
                title={feedUrl}
              >
                {feedUrl}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
