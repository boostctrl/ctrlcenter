"use client";

import TestConnectionButton from "./TestConnectionButton";

type Result = { ok?: boolean; count?: number; error?: string };

// "Test feed" button for the admin Calendar section: probes the current URL +
// credentials so the admin can confirm the feed is reachable and parsing, rather
// than guessing why the home agenda is empty. A thin adapter over
// TestConnectionButton.
export default function CalendarTest({
  url,
  username,
  password,
}: {
  url: string;
  username: string;
  password: string;
}) {
  return (
    <TestConnectionButton<Result>
      endpoint="/api/calendar/test"
      body={{ url, username, password }}
      label="Test feed"
      pendingLabel="Testing…"
      disabled={url.trim() === ""}
      renderResult={(data) =>
        data.ok ? (
          <span className="text-xs text-emerald-400">
            ✓ Reachable — {data.count} upcoming event
            {data.count === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-xs text-red-400">✗ {data.error}</span>
        )
      }
    />
  );
}
