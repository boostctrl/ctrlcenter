"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { greetingFor } from "@/lib/greeting";

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
        className="text-sm font-medium tracking-widest text-fg/40"
        suppressHydrationWarning
      >
        {date}
      </p>

      <p className="mt-1 flex items-center gap-2 text-sm font-medium tracking-wide text-fg/40">
        <span className="tabular-nums" suppressHydrationWarning>
          {time}
        </span>
        {label && (
          <>
            <span aria-hidden>·</span>
            <span className="max-w-[12rem] truncate">{label}</span>
          </>
        )}
      </p>

      <h1
        className="mt-2 text-5xl font-bold tracking-tight sm:text-6xl"
        suppressHydrationWarning
      >
        {greeting}
        {greetingName ? `, ${greetingName}` : ""}
        <span className="gradient-text">!</span>
      </h1>
    </div>
  );
}
