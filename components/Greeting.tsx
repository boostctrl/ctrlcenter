"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { greetingFor, hourIn } from "@/lib/datetime";

// The "Good evening, Name!" heading. Seeded with the server-computed greeting
// (admin default tz) and updated after mount to the visitor's effective tz. The
// name is a per-visitor preference, so it appears once prefs hydrate on mount.
export default function Greeting({
  initialGreeting,
}: {
  initialGreeting: string;
}) {
  const { timezone, greetingName } = useVisitorPrefs();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  const greeting = now ? greetingFor(hourIn(now, timezone)) : initialGreeting;

  return (
    <h1
      className="text-4xl font-bold tracking-tight sm:text-5xl"
      suppressHydrationWarning
    >
      {greeting}
      {greetingName ? `, ${greetingName}` : ""}
      <span className="gradient-text">!</span>
    </h1>
  );
}
