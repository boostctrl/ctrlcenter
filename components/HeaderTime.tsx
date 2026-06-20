"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { greetingFor } from "@/lib/greeting";
import LocationTimeEditor from "./LocationTimeEditor";

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  })
    .format(date)
    .toUpperCase();
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function hourIn(date: Date, timeZone: string): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(date),
    10
  );
}

// Renders the date, live clock, and greeting using the visitor's effective
// timezone. Seeded with server-computed strings (admin default tz) so SSR has
// real content; after mount it ticks and switches to the effective timezone.
export default function HeaderTime({
  initialDate,
  initialGreeting,
  greetingName,
}: {
  initialDate: string;
  initialGreeting: string;
  greetingName: string;
}) {
  const { timezone, location, weatherEnabled } = useVisitorPrefs();
  const [now, setNow] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  const date = now ? formatDate(now, timezone) : initialDate;
  const greeting = now ? greetingFor(hourIn(now, timezone)) : initialGreeting;
  const time = now ? formatTime(now, timezone) : " ";
  const label = weatherEnabled ? location.label : undefined;

  return (
    <div className="relative">
      <p
        className="text-sm font-medium tracking-widest text-white/40"
        suppressHydrationWarning
      >
        {date}
      </p>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Set your time zone and location"
        className="mt-1 flex items-center gap-2 rounded text-sm font-medium tracking-wide text-white/40 transition-colors hover:text-white/70 focus-visible:text-white/70 focus-visible:outline-none"
      >
        <span className="tabular-nums" suppressHydrationWarning>
          {time}
        </span>
        {label && (
          <>
            <span aria-hidden>·</span>
            <span className="max-w-[12rem] truncate">{label}</span>
          </>
        )}
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="h-3 w-3 opacity-50"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <h1
        className="mt-2 text-5xl font-bold tracking-tight sm:text-6xl"
        suppressHydrationWarning
      >
        {greeting}
        {greetingName ? `, ${greetingName}` : ""}
        <span className="gradient-text">!</span>
      </h1>

      {open && <LocationTimeEditor onClose={() => setOpen(false)} />}
    </div>
  );
}
