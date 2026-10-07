// Site-wide announcement banner, /status page notices, and outage notes.
import { z } from "zod";

// Site-wide announcement banner shown at the top of every page. The banner
// renders only when `enabled` and `message` is non-empty (see
// AnnouncementBanner). `message` is a safe inline-markdown subset (bold/italic/
// links) rendered as React elements — never raw HTML. `tone` colors the strip;
// `dismissible` adds a close button (a visitor's dismissal is remembered until
// the message changes). Stored leniently so a hand-edited file always parses.
export const ANNOUNCEMENT_TONES = [
  "info",
  "warning",
  "success",
  "accent",
] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
export const announcementSchema = z.object({
  enabled: z.boolean().catch(false),
  message: z.string().catch(""),
  tone: z.enum(ANNOUNCEMENT_TONES).catch("accent"),
  dismissible: z.boolean().catch(true),
});
export type AnnouncementConfig = z.infer<typeof announcementSchema>;

// Per-service maintenance/incident notices shown on the /status page — distinct
// from the site-wide `announcement` banner above. Each carries a `kind` that
// tints its card, a title, an inline-markdown `body` (same safe subset as the
// banner), and an optional scheduling window (`startsAt`/`endsAt` as UTC ISO
// instants, empty = unset). A shared helper derives active/scheduled/expired
// from the window (lib/status-announcements.ts). Every field is `.catch`-guarded
// so a hand-edited row coerces per-field; `id` is required, so a row missing it
// is dropped whole by the lenient array below (matching layout `sections`).
export const STATUS_ANNOUNCEMENT_KINDS = [
  "maintenance",
  "incident",
  "info",
] as const;
export type StatusAnnouncementKind = (typeof STATUS_ANNOUNCEMENT_KINDS)[number];
export const statusAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string().catch(""),
  body: z.string().catch(""),
  kind: z.enum(STATUS_ANNOUNCEMENT_KINDS).catch("info"),
  startsAt: z.string().catch(""),
  endsAt: z.string().catch(""),
});
export type StatusAnnouncement = z.infer<typeof statusAnnouncementSchema>;

// Body of PUT /api/status/history/[id]/note (#176): the incident note for one
// recorded outage, anchored by the record's exact start instant. An empty
// (post-trim) note clears the annotation. The cap keeps a note a caption, not
// a post-mortem document — and bounds what lands in status-history.json.
export const outageNoteSchema = z.object({
  start: z.number().int().positive(),
  note: z.string().max(500),
});

// The admin sends the whole announcement object.
export const announcementUpdateSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  tone: z.enum(ANNOUNCEMENT_TONES),
  dismissible: z.boolean(),
});
