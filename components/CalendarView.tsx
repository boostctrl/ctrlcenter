"use client";

import { useState } from "react";
import CalendarMonth from "./CalendarMonth";
import AgendaList from "./AgendaList";
import type { CalendarEvent } from "@/lib/calendar";

type View = "month" | "agenda";

// The /calendar page body: a Month/Agenda switch over the two views. Month is the
// default here (the home widget defaults to agenda). Both datasets are fetched
// server-side — month gets a date range, agenda the next N upcoming.
export default function CalendarView({
  monthEvents,
  agendaEvents,
  now,
  minOffset,
  maxOffset,
}: {
  monthEvents: CalendarEvent[];
  agendaEvents: CalendarEvent[];
  now: number;
  minOffset?: number;
  maxOffset?: number;
}) {
  const [view, setView] = useState<View>("month");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-fit overflow-hidden rounded-lg border border-fg/10 text-sm">
        {(["month", "agenda"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-4 py-2 capitalize transition-colors ${
              view === v ? "bg-fg/15 text-fg" : "text-fg/50 hover:text-fg/80"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "month" ? (
        <section className="glass-card p-4 sm:p-6">
          <CalendarMonth
            events={monthEvents}
            now={now}
            minOffset={minOffset}
            maxOffset={maxOffset}
          />
        </section>
      ) : agendaEvents.length > 0 ? (
        <section className="glass-card max-w-2xl p-6">
          <AgendaList events={agendaEvents} now={now} />
        </section>
      ) : (
        <p className="text-fg/50">No upcoming events.</p>
      )}
    </div>
  );
}
