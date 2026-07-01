"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { buildMonthGrid, bucketByDay, type CalendarEvent } from "@/lib/calendar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

// Day buckets and the today flag use the visitor's effective time zone — it
// starts as the admin default so the first render matches SSR, then switches on
// mount (like AgendaList), so the tz-dependent bits are marked
// suppressHydrationWarning. `now` is passed in so the first render is pure.

// Interactive month grid for the /calendar page. Navigation is clamped to
// [minOffset, maxOffset] — the span of months the server pre-fetched events for.
export default function CalendarMonth({
  events,
  now,
  minOffset = -1,
  maxOffset = 3,
}: {
  events: CalendarEvent[];
  now: number;
  minOffset?: number;
  maxOffset?: number;
}) {
  const { timezone } = useVisitorPrefs();
  const [offset, setOffset] = useState(0);
  const grid = useMemo(
    () => buildMonthGrid(now, timezone, offset),
    [now, timezone, offset]
  );
  const byDay = useMemo(() => bucketByDay(events, timezone), [events, timezone]);

  const navBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-fg/10 bg-fg/[0.04] text-lg text-fg/70 transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          className="text-lg font-semibold tracking-tight"
          suppressHydrationWarning
        >
          {grid.label}
        </h2>
        <div className="flex items-center gap-1.5">
          {offset !== 0 && (
            <button
              type="button"
              onClick={() => setOffset(0)}
              className="rounded-lg border border-fg/10 bg-fg/[0.04] px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10"
            >
              Today
            </button>
          )}
          <button
            type="button"
            aria-label="Previous month"
            disabled={offset <= minOffset}
            onClick={() => setOffset((o) => Math.max(minOffset, o - 1))}
            className={navBtn}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={offset >= maxOffset}
            onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
            className={navBtn}
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="pb-1 text-center text-xs font-medium tracking-wide text-fg/40 uppercase"
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
        {grid.weeks.flat().map((cell) => {
          const dayEvents = byDay.get(cell.iso) ?? [];
          return (
            <div
              key={cell.iso}
              suppressHydrationWarning
              className={`flex min-h-[4.5rem] flex-col gap-1 rounded-lg border border-fg/5 p-1.5 sm:min-h-[6rem] ${
                cell.inMonth ? "bg-fg/[0.03]" : "bg-transparent"
              }`}
            >
              <span
                suppressHydrationWarning
                className={`flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${
                  cell.isToday
                    ? "bg-[color:var(--accent-from)] font-semibold text-[color:var(--accent-fg)]"
                    : cell.inMonth
                      ? "text-fg/70"
                      : "text-fg/30"
                }`}
              >
                {cell.day}
              </span>
              <ul className="flex min-w-0 flex-col gap-0.5" suppressHydrationWarning>
                {dayEvents.slice(0, MAX_CHIPS).map((e, i) => (
                  <li
                    key={i}
                    title={e.summary}
                    className="flex items-center gap-1 rounded bg-fg/[0.06] px-1.5 py-0.5 text-[0.7rem] leading-tight text-fg/80"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent-from)]"
                      aria-hidden
                    />
                    <span className="truncate">{e.summary}</span>
                  </li>
                ))}
                {dayEvents.length > MAX_CHIPS && (
                  <li className="px-1 text-[0.7rem] text-fg/45">
                    +{dayEvents.length - MAX_CHIPS} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact current-month grid for the home widget: day numbers with an accent dot
// on days that have events. Rendered inside a link to /calendar by CalendarWidget;
// `hint` is an optional right-aligned affordance in the header (e.g. "View calendar").
export function MiniMonth({
  events,
  now,
  hint,
}: {
  events: CalendarEvent[];
  now: number;
  hint?: ReactNode;
}) {
  const { timezone } = useVisitorPrefs();
  const grid = useMemo(() => buildMonthGrid(now, timezone, 0), [now, timezone]);
  const byDay = useMemo(() => bucketByDay(events, timezone), [events, timezone]);

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 flex items-center justify-between gap-4">
        <span
          className="text-sm font-semibold tracking-tight text-fg/80"
          suppressHydrationWarning
        >
          {grid.label}
        </span>
        {hint}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[0.65rem] font-medium tracking-wide text-fg/35 uppercase"
          >
            {d[0]}
          </div>
        ))}
        {grid.weeks.flat().map((cell) => {
          const has = (byDay.get(cell.iso)?.length ?? 0) > 0;
          return (
            <div
              key={cell.iso}
              suppressHydrationWarning
              className="relative flex aspect-square items-center justify-center"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                  cell.isToday
                    ? "bg-[color:var(--accent-from)] font-semibold text-[color:var(--accent-fg)]"
                    : cell.inMonth
                      ? "text-fg/75"
                      : "text-fg/30"
                }`}
              >
                {cell.day}
              </span>
              {has && !cell.isToday && (
                <span
                  className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[color:var(--accent-from)]"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
