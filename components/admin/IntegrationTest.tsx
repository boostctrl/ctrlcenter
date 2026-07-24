"use client";

import type { ServiceId } from "@/lib/services/ids";
import TestConnectionButton from "./TestConnectionButton";

type Result = { ok?: boolean; detail?: string; error?: string };

// "Test connection" button for an Integrations card: probes the values
// currently in the form (before saving) via the admin-only /api/monitor/test
// route, and names what answered ("qBittorrent v5.0.1") so the admin knows the
// right service is on the other end. A thin adapter over TestConnectionButton.
export default function IntegrationTest({
  service,
  url,
  username,
  password,
  apiKey,
  allowInsecureTls,
}: {
  service: ServiceId;
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  allowInsecureTls?: boolean;
}) {
  return (
    <TestConnectionButton<Result>
      endpoint="/api/monitor/test"
      body={{ service, url, username, password, apiKey, allowInsecureTls }}
      label="Test connection"
      pendingLabel="Testing…"
      disabled={url.trim() === ""}
      renderResult={(data) =>
        data.ok ? (
          <span className="text-xs text-emerald-400">
            ✓ Connected{data.detail ? ` — ${data.detail}` : ""}
          </span>
        ) : (
          <span className="text-xs text-red-400">✗ {data.error}</span>
        )
      }
    />
  );
}
