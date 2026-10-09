// The status page as an Atom feed (#295): outages, with their incident notes,
// and the status announcements, so people can subscribe instead of checking.
// Pure: the route (app/status/feed.xml) gathers the data.
import type { OutageEntry } from "./status";
import type { StatusAnnouncement } from "./schema";
import { STATUS_ANNOUNCEMENT_KIND_META } from "./status-announcements";

export const MAX_FEED_ENTRIES = 50;

export type FeedInput = {
  title: string;
  origin: string;
  now: number;
  outages: { app: { id: string; name: string }; outage: OutageEntry }[];
  announcements: StatusAnnouncement[];
  // When an announcement without a window last changed (the config file's
  // mtime): Atom needs an `updated` for every entry, and this one is stable
  // between edits.
  announcementsUpdated: number;
};

type Entry = { id: string; title: string; updated: number; link: string; content: string };

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "Oct 9, 2026, 12:54 PM UTC": feed readers show content as written, so pick
// one zone and say which.
function when(ms: number): string {
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms))} UTC`;
}

export function duration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return mins % 60 ? `${hrs}h ${mins % 60}m` : `${hrs}h`;
  return hrs % 24 ? `${Math.floor(hrs / 24)}d ${hrs % 24}h` : `${Math.floor(hrs / 24)}d`;
}

function instant(value: string): number | null {
  const ms = value.trim() ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function outageEntry(
  origin: string,
  app: { id: string; name: string },
  o: OutageEntry,
  now: number
): Entry {
  const ongoing = o.endMs == null;
  const lines = [
    ongoing
      ? `Down since ${when(o.startMs)}.`
      : `Down from ${when(o.startMs)} to ${when(o.endMs!)}${o.exact ? "" : " (approximate)"}.`,
  ];
  if (o.note) lines.push(`Note: ${o.note}`);
  return {
    // The start identifies the outage (it's what notes anchor to), so the
    // entry for an ongoing outage becomes its completed form, not a new one.
    id: `urn:ctrlcenter:outage:${encodeURIComponent(app.id)}:${o.startMs}`,
    title: ongoing
      ? `${app.name} is down`
      : `${app.name} was down for ${duration(o.downMs)}`,
    updated: o.endMs ?? Math.min(o.startMs, now),
    link: `${origin}/status/${encodeURIComponent(app.id)}`,
    content: lines.join("\n\n"),
  };
}

function announcementEntry(origin: string, a: StatusAnnouncement, fallback: number): Entry {
  const start = instant(a.startsAt);
  const end = instant(a.endsAt);
  const label = STATUS_ANNOUNCEMENT_KIND_META[a.kind].label;
  const window =
    start != null && end != null
      ? `From ${when(start)} to ${when(end)}.`
      : start != null
        ? `From ${when(start)}.`
        : end != null
          ? `Until ${when(end)}.`
          : "";
  return {
    id: `urn:ctrlcenter:announcement:${encodeURIComponent(a.id)}`,
    title: `${label}: ${a.title.trim() || "(untitled)"}`,
    updated: start ?? end ?? fallback,
    link: `${origin}/status`,
    content: [a.body.trim(), window].filter(Boolean).join("\n\n"),
  };
}

export function buildStatusFeed(input: FeedInput): string {
  const { origin, now } = input;
  const entries = [
    ...input.outages.map((o) => outageEntry(origin, o.app, o.outage, now)),
    ...input.announcements.map((a) => announcementEntry(origin, a, input.announcementsUpdated)),
  ]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, MAX_FEED_ENTRIES);
  const updated = entries.length > 0 ? Math.max(...entries.map((e) => e.updated)) : now;
  const iso = (ms: number) => new Date(ms).toISOString();
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <title>${escapeXml(`${input.title} status`)}</title>\n` +
    `  <id>${escapeXml(`${origin}/status`)}</id>\n` +
    `  <link rel="alternate" href="${escapeXml(`${origin}/status`)}"/>\n` +
    `  <link rel="self" href="${escapeXml(`${origin}/status/feed.xml`)}"/>\n` +
    `  <updated>${iso(updated)}</updated>\n` +
    // Atom wants an author for the feed when its entries name none.
    `  <author><name>${escapeXml(input.title)}</name></author>\n` +
    `  <generator>CtrlCenter</generator>\n` +
    entries
      .map(
        (e) =>
          `  <entry>\n` +
          `    <id>${escapeXml(e.id)}</id>\n` +
          `    <title>${escapeXml(e.title)}</title>\n` +
          `    <updated>${iso(e.updated)}</updated>\n` +
          `    <link href="${escapeXml(e.link)}"/>\n` +
          `    <content type="text">${escapeXml(e.content)}</content>\n` +
          `  </entry>\n`
      )
      .join("") +
    `</feed>\n`
  );
}
