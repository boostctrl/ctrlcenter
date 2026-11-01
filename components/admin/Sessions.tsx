"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Hint, SelectField, subCardClasses } from "./ui";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";
import { relativeTime } from "../StatusTimeline";

// The admin Security section's sessions card (#365): the idle timeout, the
// sessions currently signed in (this one marked), each with a way to end it,
// and "Sign out everywhere else". Ending this session sends the browser to
// the login page.

type Session = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  ip: string | null;
  userAgent: string;
  current: boolean;
  // The account the session belongs to (#423); a record 3.0 wrote names
  // none, which is the founding admin's.
  account?: string;
};

const IDLE_CHOICES: { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

// A short "Chrome on macOS" from a User-Agent, for telling sessions apart; the
// raw string stays available as the row's title. Order matters: Chrome's UA
// also says Safari, Edge's also says Chrome.
export function describeUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (browser && os) return `${browser} on ${os}`;
  if (browser || os) return browser ?? os ?? "";
  return ua ? "Unknown browser" : "Unknown client";
}

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [idleHours, setIdleHours] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(apiErrorMessage(data, "Couldn't load sessions"), "error");
        return;
      }
      setSessions(data.sessions);
      setIdleHours(data.idleHours);
      setNow(Date.now());
    } catch {
      toast("Couldn't load sessions", "error");
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function changeIdle(hours: number) {
    const previous = idleHours;
    setIdleHours(hours);
    try {
      const res = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idleHours: hours }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setIdleHours(previous);
        toast(apiErrorMessage(data, "Couldn't save the timeout"), "error");
        return;
      }
      setIdleHours(data.idleHours);
      // A shorter timeout may have ended idle sessions.
      void load();
    } catch {
      setIdleHours(previous);
      toast("Couldn't save the timeout", "error");
    }
  }

  async function end(session: Session) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(apiErrorMessage(data, "Couldn't end the session"), "error");
        return;
      }
      if (session.current) {
        router.push("/admin/login");
        router.refresh();
        return;
      }
      toast("Session ended");
      setSessions((prev) => prev?.filter((s) => s.id !== session.id) ?? null);
    } catch {
      toast("Couldn't end the session", "error");
    } finally {
      setBusy(false);
    }
  }

  async function endOthers() {
    setBusy(true);
    try {
      const res = await fetch("/api/sessions/others", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(apiErrorMessage(data, "Couldn't sign out other sessions"), "error");
        return;
      }
      const ended = typeof data?.ended === "number" ? data.ended : 0;
      toast(ended === 1 ? "Signed out 1 other session" : `Signed out ${ended} other sessions`);
      setSessions((prev) => prev?.filter((s) => s.current) ?? null);
    } catch {
      toast("Couldn't sign out other sessions", "error");
    } finally {
      setBusy(false);
    }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;
  // The stored timeout may be a value the picker doesn't list (set by hand
  // or by a later version); show it rather than snap to the nearest choice.
  const choices =
    idleHours !== null && !IDLE_CHOICES.some((c) => c.hours === idleHours)
      ? [...IDLE_CHOICES, { hours: idleHours, label: `${idleHours} hours` }].sort((a, b) => a.hours - b.hours)
      : IDLE_CHOICES;

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Sign out after"
        hint="A session unused for this long ends on its own. Every session ends 7 days after it signed in regardless."
        value={idleHours ?? 24}
        disabled={idleHours === null}
        onChange={(e) => void changeIdle(Number(e.target.value))}
      >
        {choices.map((c) => (
          <option key={c.hours} value={c.hours}>
            {c.label}
          </option>
        ))}
      </SelectField>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-ink-70">Signed-in sessions</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || others === 0}
            onClick={() => void endOthers()}
          >
            Sign out everywhere else
          </Button>
        </div>
        {sessions === null ? (
          <Hint>Loading…</Hint>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`${subCardClasses} flex items-center justify-between gap-4 px-4 py-3`}
              >
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-90" title={s.userAgent}>
                      {describeUserAgent(s.userAgent)}
                    </span>
                    {s.current && (
                      <span className="rounded-full border border-fg/15 px-2 py-0.5 text-[11px] font-medium text-ink-60">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-45">
                    {s.account ?? "admin"} · {s.ip ?? "Unknown address"} · signed in {relativeTime(s.createdAt, now)} · last seen{" "}
                    {relativeTime(s.lastSeenAt, now)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={s.current ? "danger" : "ghost"}
                  size="sm"
                  disabled={busy}
                  onClick={() => void end(s)}
                >
                  {s.current ? "Sign out" : "End"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
