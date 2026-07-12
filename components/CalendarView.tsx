"use client";

import { useState } from "react";
import CalendarMonth from "./CalendarMonth";
import AgendaList from "./AgendaList";
import { ChipGroup } from "./ChipGroup";
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
      <ChipGroup
        label="Calendar view"
        size="lg"
        fit
        capitalize
        options={(["month", "agenda"] as const).map((v) => ({
          value: v,
          label: v,
        }))}
        value={view}
        onChange={setView}
      />

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
