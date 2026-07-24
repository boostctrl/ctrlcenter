"use client";

import { buttonClasses } from "@/lib/buttons";
import TestConnectionButton from "./TestConnectionButton";

type Result = {
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
// offers them as one-click fills (via onPick). A thin adapter over
// TestConnectionButton.
export default function FeedTest({
  url,
  onPick,
}: {
  url: string;
  onPick?: (url: string) => void;
}) {
  return (
    <TestConnectionButton<Result>
      endpoint="/api/feed/test"
      body={{ url }}
      label="Test feed"
      pendingLabel="Testing…"
      disabled={url.trim() === ""}
      renderResult={(data) =>
        data.ok ? (
          <span className="text-xs text-emerald-400">
            ✓ {data.title ? `“${data.title}”` : "Readable"} — {data.count}{" "}
            entr{data.count === 1 ? "y" : "ies"}
          </span>
        ) : (
          <span className="text-xs text-red-400">✗ {data.error}</span>
        )
      }
      renderExtra={(data) =>
        data.discovered && data.discovered.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-fg/45">
              {data.discovered.length === 1 ? "Found a feed" : "Found feeds"} —
              use{data.discovered.length === 1 ? " it" : " one"}:
            </span>
            <div className="flex flex-wrap gap-2">
              {data.discovered.map((feedUrl) => (
                <button
                  key={feedUrl}
                  type="button"
                  onClick={() => onPick?.(feedUrl)}
                  disabled={!onPick}
                  className={`${buttonClasses("ghost", "sm")} max-w-full truncate`}
                  title={feedUrl}
                >
                  {feedUrl}
                </button>
              ))}
            </div>
          </div>
        ) : null
      }
    />
  );
}
