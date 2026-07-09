"use client";

import { useEffect, useMemo, useState } from "react";
import { parseInline } from "@/lib/markdown";
import { useVisitorPrefs } from "./PrefsProvider";
import InlineMarkdown from "./InlineMarkdown";
import { ANNOUNCEMENT_TONE_STYLES } from "@/lib/announcement-tones";
import {
  visibleAnnouncements,
  announcementWindowLabel,
} from "@/lib/status-announcements";
import type {
  AnnouncementTone,
  StatusAnnouncement,
  StatusAnnouncementKind,
} from "@/lib/schema";

// Each announcement kind borrows a banner tone so the /status cards read in the
// same visual language as the site-wide banner: maintenance is informational
// (blue), an incident is a warning (amber), a general note takes the accent.
const KIND_TONE: Record<StatusAnnouncementKind, AnnouncementTone> = {
  maintenance: "info",
  incident: "warning",
  info: "accent",
};

const KIND_LABEL: Record<StatusAnnouncementKind, string> = {
  maintenance: "Maintenance",
  incident: "Incident",
  info: "Notice",
};

// The /status page's announcements section: maintenance windows and upcoming
// changes, rendered above the per-app rows (and above the "checks are off" note
// when status checks are disabled — a maintenance notice is content in its own
// right). Entries derive their own state from an optional window: active ones
// show first, then scheduled; expired ones don't render. `now` ticks so a
// scheduled entry flips to active (and an ending one drops away) without a
// reload. Times are formatted in the visitor's own time zone, like the timeline.
export default function StatusAnnouncements({
  announcements,
}: {
  announcements: StatusAnnouncement[];
}) {
  const { timezone } = useVisitorPrefs();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => visibleAnnouncements(announcements, now),
    [announcements, now]
  );

  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="status-announcements-heading" className="space-y-3">
      <h2
        id="status-announcements-heading"
        className="text-xs font-semibold tracking-[0.15em] text-fg/45 uppercase"
      >
        Announcements
      </h2>
      <ul className="space-y-3">
        {visible.map(({ announcement, state }) => {
          const tone = KIND_TONE[announcement.kind];
          const { bg, color } = ANNOUNCEMENT_TONE_STYLES[tone];
          const windowLabel = announcementWindowLabel(
            announcement,
            state,
            timezone
          );
          return (
            <li
              key={announcement.id}
              className="rounded-xl border border-l-4 border-fg/10 p-4"
              style={{ background: bg, borderLeftColor: color }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-[0.7rem] font-semibold tracking-[0.12em] uppercase"
                  style={{ color }}
                >
                  {KIND_LABEL[announcement.kind]}
                </span>
                {state === "scheduled" && (
                  <span className="rounded-full bg-fg/10 px-2 py-0.5 text-[0.7rem] font-medium text-fg/60">
                    Scheduled
                  </span>
                )}
              </div>
              {announcement.title && (
                <p className="mt-1.5 font-semibold text-fg/90">
                  {announcement.title}
                </p>
              )}
              {announcement.body && (
                <p className="mt-1 text-sm text-fg/70">
                  <InlineMarkdown tokens={parseInline(announcement.body)} />
                </p>
              )}
              {windowLabel && (
                <p className="mt-2 text-xs text-fg/50">{windowLabel}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
