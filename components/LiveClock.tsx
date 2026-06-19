"use client";

import { useEffect, useState } from "react";

// Ticking wall-clock for the configured timezone. Rendered client-side only
// (gated on `mounted`) so the server/client first paint can't disagree on the
// current second and trigger a hydration mismatch.
export default function LiveClock({ timeZone }: { timeZone?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Drive updates from the timer callback (not synchronously in the effect
    // body) so the first paint stays the SSR placeholder until the client
    // takes over a tick later.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  // Reserve vertical space before mount so the header doesn't shift.
  const time = now
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: timeZone || undefined,
      }).format(now)
    : " ";

  return (
    <p
      className="mt-1 text-sm font-medium tabular-nums tracking-wide text-white/40"
      suppressHydrationWarning
    >
      {time}
    </p>
  );
}
