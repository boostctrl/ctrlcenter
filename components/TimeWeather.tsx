"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocalePrefs } from "./PrefsProvider";
import { usePolling } from "./usePolling";
import { shortDate, timeString } from "@/lib/datetime";
import {
  fetchWeather,
  unitSymbol,
  weatherCodeToIcon,
  type CurrentWeather,
} from "@/lib/weather";

// Header widget: live date + clock in the visitor's effective time zone, plus
// the weather when enabled (server-rendered default, re-fetched client-side
// when the visitor's location/units differ).
export default function TimeWeather({
  initialDate,
  weatherEnabled,
  showClock = true,
  initial,
}: {
  initialDate: string;
  weatherEnabled: boolean;
  showClock?: boolean;
  initial: CurrentWeather | null;
}) {
  const { timezone, location, units } = useLocalePrefs();
  const [now, setNow] = useState<Date | null>(null);
  const [fetched, setFetched] = useState<CurrentWeather | null>(null);

  useEffect(() => {
    if (!showClock) return; // no clock to tick when it's hidden
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [showClock]);

  // Always refetch live on mount (and every 10 min, while the tab is visible)
  // for the effective location/units, rather than relying on the server-cached
  // SSR seed. This keeps the widget current and in sync with the /weather page,
  // which refetches the same way — the two no longer drift apart on
  // independent 30-min cache windows.
  const loadWeather = useCallback(
    async (signal: AbortSignal) => {
      const w = await fetchWeather(location.latitude, location.longitude, units, signal);
      if (w && !signal.aborted) setFetched(w);
    },
    [location.latitude, location.longitude, units]
  );
  usePolling(loadWeather, 10 * 60 * 1000, { enabled: weatherEnabled });

  const weather = fetched ?? initial;
  const time = now ? timeString(now, timezone) : " ";
  const date = now ? shortDate(now, timezone) : initialDate;
  const showWeather = weatherEnabled && weather;
  // With only one of the two blocks present (weather or clock toggled off, or
  // the weather still loading), the two-ended row layout would leave the lone
  // block hugging the left edge with dead space beside it (#105) — center it
  // instead so the single-element card looks deliberate.
  const paired = Boolean(showWeather && showClock);

  const inner = (
    <>
      {showWeather && (
        <>
          <div className="flex items-center gap-3">
            <span className="wx-icon text-4xl" aria-hidden>
              {weatherCodeToIcon(weather.code, weather.isDay)}
            </span>
            <div>
              <p className="text-2xl leading-tight font-semibold">
                {Math.round(weather.temperature)}
                {unitSymbol(units)}
              </p>
              <p className="text-xs text-ink-50">
                {Math.round(weather.humidity)}% humidity
              </p>
            </div>
          </div>
          {showClock && <div className="hidden h-10 w-px bg-fg/10 @min-[22rem]:block" />}
        </>
      )}
      {showClock && (
        <div className={paired ? "@min-[22rem]:text-right" : ""}>
          <p
            className="text-2xl leading-tight font-semibold tabular-nums"
            suppressHydrationWarning
          >
            {time}
          </p>
          <p
            className="text-xs tracking-wide text-ink-50"
            suppressHydrationWarning
          >
            {date}
            {weatherEnabled && location.label ? ` · ${location.label}` : ""}
          </p>
        </div>
      )}
    </>
  );

  // The card chrome (glass surface) lives in the parent so an optional status
  // row can share the same card; this just renders the time/weather row with
  // its own padding. The parent card is a `@container`, so the row keys off the
  // card's own width: weather and clock sit at opposite ends when it's wide
  // enough, and stack vertically (divider hidden, clock left-aligned) when it
  // isn't — narrow cells stack instead of clipping. Side by side from 22rem
  // (#453): the stock span-8 card is 379px wide on a 1280px viewport (a
  // 13-inch laptop at 250% scaling), where the old 24rem step stacked the
  // clock under the weather for no reason. Between 22rem and 24rem the
  // padding and gaps are a step tighter, so the widest content (100°F, 100%
  // humidity, 12:55:13 PM) still fits, and the row may wrap rather than
  // clip should a wider font push it past the edge. When weather is on, the
  // row links to the full forecast.
  const row = `flex flex-col gap-3 px-6 py-4 @min-[22rem]:flex-row @min-[22rem]:flex-wrap @min-[22rem]:items-center @min-[22rem]:gap-x-4 @min-[22rem]:gap-y-3 @min-[22rem]:px-5 @sm:gap-x-5 @sm:px-6 ${
    paired ? "@min-[22rem]:justify-between" : "@min-[22rem]:justify-center"
  }`;
  return weatherEnabled ? (
    <Link
      href="/weather"
      title="View forecast"
      className={`${row} transition-colors hover:bg-fg/[0.03]`}
    >
      {inner}
    </Link>
  ) : (
    <div className={row}>{inner}</div>
  );
}
