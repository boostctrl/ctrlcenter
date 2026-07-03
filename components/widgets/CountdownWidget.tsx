"use client";

import { useEffect, useMemo, useState } from "react";
import SectionTitle from "../SectionTitle";
import { useVisitorPrefs } from "../PrefsProvider";

// Admin-authored countdown card: labeled dates rendered as "in N days" rows in
// the visitor's effective time zone. Day math happens after mount (the server
// can't know the visitor's zone, and a clock mismatch would break hydration),
// so the chips fill in on the first client render. Rows without a valid
// YYYY-MM-DD date are ignored; Dashboard renders the widget only when at
// least one valid row exists.

export type CountdownItem = { label: string; date: string };

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidCountdownDate(date: string): boolean {
  return DATE_RE.test(date.trim());
}

// "YYYY-MM-DD" of the instant in the given zone (en-CA formats exactly so);
// falls back to UTC on an invalid zone.
function localDayStr(now: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

// Whole calendar days from today (in `timeZone`) to the target date: 0 today,
// positive upcoming, negative past; null for an invalid date string.
function daysUntil(date: string, now: number, timeZone: string): number | null {
  const m = DATE_RE.exec(date.trim());
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const [ty, tm, td] = localDayStr(now, timeZone).split("-").map(Number);
  return Math.round((target - Date.UTC(ty, tm - 1, td)) / DAY_MS);
}

function chipText(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

// "Jul 24, 2026" — the date is a plain calendar date, so format it in UTC to
// keep it from shifting a day in western zones.
function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date.trim()}T00:00:00Z`));
}

export default function CountdownWidget({
  title,
  items,
  showTitle = true,
  maxBodyHeight,
}: {
  title: string;
  items: CountdownItem[];
  // Show the section heading; the layout editor's label toggle turns it off.
  showTitle?: boolean;
  // Cap the list height (px), scrolling past it; from the layout editor.
  maxBodyHeight?: number;
}) {
  const { timezone } = useVisitorPrefs();
  // Post-mount clock, refreshed each minute so an open tab rolls over midnight.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Valid rows with their day counts: upcoming soonest-first, then past dates
  // most-recent-first, sinking below the things still ahead.
  const rows = useMemo(() => {
    const valid = items.filter((i) => isValidCountdownDate(i.date));
    if (now === null) {
      return valid.map((item) => ({ item, days: null as number | null }));
    }
    return valid
      .map((item) => ({ item, days: daysUntil(item.date, now, timezone) }))
      .sort((a, b) => {
        const ad = a.days ?? 0;
        const bd = b.days ?? 0;
        if (ad >= 0 !== bd >= 0) return ad >= 0 ? -1 : 1;
        return ad >= 0 ? ad - bd : bd - ad;
      });
  }, [items, now, timezone]);

  if (rows.length === 0) return null;
  return (
    <section>
      {showTitle && title.trim() !== "" && <SectionTitle>{title}</SectionTitle>}
      <div
        className="glass-card p-6"
        style={
          maxBodyHeight
            ? { maxHeight: maxBodyHeight, overflowY: "auto" }
            : undefined
        }
      >
        <ul className="divide-y divide-fg/10">
          {rows.map(({ item, days }, i) => {
            const past = days !== null && days < 0;
            const highlight = days === 0 || days === 1;
            return (
              <li
                key={`${item.date}-${item.label}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm ${
                      past ? "text-fg/40" : "text-fg/80"
                    }`}
                  >
                    {item.label.trim() || dateLabel(item.date)}
                  </p>
                  <p className="text-xs text-fg/40">{dateLabel(item.date)}</p>
                </div>
                {days !== null && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums ${
                      highlight
                        ? "font-medium"
                        : past
                          ? "text-fg/35"
                          : "bg-fg/10 text-fg/60"
                    }`}
                    style={
                      highlight
                        ? {
                            background:
                              "color-mix(in srgb, var(--accent-from) 22%, transparent)",
                            color: "var(--fg)",
                          }
                        : undefined
                    }
                  >
                    {chipText(days)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
