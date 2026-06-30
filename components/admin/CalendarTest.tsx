"use client";

import { useState } from "react";

type Result = { loading: boolean; ok?: boolean; count?: number; error?: string };

// "Test feed" button for the admin Calendar section: probes the current URL +
// credentials so the admin can confirm the feed is reachable and parsing, rather
// than guessing why the home agenda is empty.
export default function CalendarTest({
  url,
  username,
  password,
}: {
  url: string;
  username: string;
  password: string;
}) {
  const [state, setState] = useState<Result>({ loading: false });

  async function run() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/calendar/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, username, password }),
      });
      const data = await res.json().catch(() => null);
      setState({
        loading: false,
        ok: data?.ok,
        count: data?.count,
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
        {state.loading ? "Testing…" : "Test feed"}
      </button>
      {!state.loading && state.ok === true && (
        <span className="text-xs text-emerald-400">
          ✓ Reachable — {state.count} upcoming event{state.count === 1 ? "" : "s"}
        </span>
      )}
      {!state.loading && state.ok === false && (
        <span className="text-xs text-red-400">✗ {state.error}</span>
      )}
    </div>
  );
}
