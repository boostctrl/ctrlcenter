"use client";

import { useEffect, useState } from "react";
import SectionTitle from "../SectionTitle";
import { isValidTimeZone, timeString, formatInZone } from "@/lib/datetime";

// Admin-authored world-clocks card: labeled IANA time zones rendered as live
// clocks, each showing the current wall-clock time and day in its own zone.
// Unlike the header clock, the zones are explicit (not the visitor's), so the
// server can seed the first render: `initialNow` is the request instant as an
// ISO string, used for both SSR and the first client paint (so hydration
// matches) before the once-a-second tick takes over. Rows with an invalid zone
// are dropped; Dashboard renders the widget only when at least one is valid.

export type WorldClockItem = { label: string; timeZone: string };

// "New York" from "America/New_York" — the last IANA segment, underscores to
// spaces — as a label when the admin didn't give one.
function zoneCity(timeZone: string): string {
  const seg = timeZone.split("/").pop() ?? timeZone;
  return seg.replace(/_/g, " ");
}

export default function WorldClocksWidget({
  title,
  items,
  initialNow,
  showTitle = true,
}: {
  title: string;
  items: WorldClockItem[];
  // The server's request instant (ISO) — seeds the clocks so they render with
  // the right time immediately instead of flashing blank until mount.
  initialNow: string;
  // Show the section heading; the layout editor's label toggle turns it off.
  showTitle?: boolean;
}) {
  const [now, setNow] = useState<Date>(() => new Date(initialNow));
  // Retick each second so the seconds stay live in an open tab.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
    return () => clearTimeout(timer);
  }, []);

  const clocks = items.filter((i) => isValidTimeZone(i.timeZone.trim()));
  if (clocks.length === 0) return null;

  return (
    <section>
      {showTitle && title.trim() !== "" && <SectionTitle>{title}</SectionTitle>}
      <div className="glass-card p-6">
        <ul className="divide-y divide-fg/10">
          {clocks.map((item, i) => {
            const zone = item.timeZone.trim();
            return (
              <li
                key={`${zone}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg/80">
                    {item.label.trim() || zoneCity(zone)}
                  </p>
                  <p className="text-xs text-fg/40">
                    {formatInZone(now, zone, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <span className="shrink-0 text-lg font-medium tabular-nums text-fg/90">
                  {timeString(now, zone)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
