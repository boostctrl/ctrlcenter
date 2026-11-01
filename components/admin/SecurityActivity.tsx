"use client";

import { useEffect, useState } from "react";
import { Hint } from "./ui";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";
import { relativeTime } from "../StatusTimeline";
import { describeUserAgent } from "./Sessions";
import type { SecurityEvent, SecurityEventKind } from "@/lib/security-events";

// The Recent activity card's body (#368): the latest security events,
// newest first, each as a sentence with where it came from.

const LABEL: Record<SecurityEventKind, string> = {
  "signin.ok": "Signed in",
  "signin.fail": "Failed sign-in",
  "signin.locked": "Login locked after repeated failures",
  signout: "Signed out",
  "session.ended": "Session ended",
  "sessions.ended": "Signed out everywhere else",
  "password.changed": "Password changed",
  "totp.enabled": "Two-factor authentication turned on",
  "totp.disabled": "Two-factor authentication turned off",
  "reauth.ok": "Confirmed password",
  "reauth.fail": "Failed confirmation",
  "password.fail": "Wrong current password",
  "export.secrets": "Exported with secrets",
  "integration.changed": "Integration address or credentials changed",
  "actions.enabled": "Dashboard actions turned on",
  action: "Dashboard action",
};

// The entries that mean something went wrong, or that reshape the account.
const NOTABLE: ReadonlySet<SecurityEventKind> = new Set([
  "signin.fail",
  "signin.locked",
  "reauth.fail",
  "password.fail",
  "totp.disabled",
  "password.changed",
  "actions.enabled",
  "export.secrets",
]);

export function describeEvent(e: SecurityEvent): string {
  const base = LABEL[e.kind] ?? e.kind;
  const times = e.count && e.count > 1 ? ` × ${e.count}` : "";
  const spread = e.addresses && e.addresses > 1 ? ` from ${e.addresses} addresses` : "";
  const detail = e.detail ? `: ${e.detail}` : "";
  const fresh = e.kind === "signin.ok" && e.newAddress ? " (new address)" : "";
  return `${base}${times}${spread}${detail}${fresh}`;
}

export default function SecurityActivity({ version }: { version: number }) {
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/security/events");
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          toast(apiErrorMessage(data, "Couldn't load the activity"), "error");
          return;
        }
        setEvents(data.events);
        setNow(Date.now());
      } catch {
        if (!cancelled) toast("Couldn't load the activity", "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, toast]);

  if (events === null) return <Hint>Loading…</Hint>;
  if (events.length === 0) return <Hint>Nothing yet. Sign-ins and security changes will show here.</Hint>;
  return (
    <ul className="flex flex-col divide-y divide-fg/10 text-sm">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex items-start justify-between gap-4 py-2">
          <div className="min-w-0">
            <span className={NOTABLE.has(e.kind) ? "font-medium text-ink-90" : "text-ink-80"}>
              {describeEvent(e)}
            </span>
            <p className="text-xs text-ink-45" title={e.userAgent}>
              {e.ip ?? "Unknown address"} · {describeUserAgent(e.userAgent)}
            </p>
          </div>
          <time dateTime={new Date(e.at).toISOString()} className="shrink-0 text-xs text-ink-45">
            {relativeTime(e.at, now)}
          </time>
        </li>
      ))}
    </ul>
  );
}
