// The feed (RSS/Atom/JSON Feed) widget's content; each card is a widget
// instance (lib/schema/instances.ts).
import { z } from "zod";

// Cap on how many feed URLs one widget can fan out to. Each is a separate
// server-side fetch per home-page render (the page is force-dynamic), so the
// list is bounded — generous for real use, a guard against a hand-edited or
// imported config turning the widget into an unbounded outbound-request source.
export const MAX_FEED_URLS = 10;

// Cap on how many feed cards (instances) a save holds the board to, against
// a hand-edited or imported config spawning unbounded cards. It bounds what
// can be added, not one render's fan-out: a list stored past it (a 2.x file
// hand-edited past it and upgraded, #426, #438) renders every card. Each
// card's URLs are cut to MAX_FEED_URLS when fetched (lib/feed.ts); the
// stored list isn't cut on read.
export const MAX_FEED_CARDS = 8;

// One feed card (RSS/Atom/JSON Feed) fed by one or more public feed URLs,
// merged newest-first. Stored leniently; URLs are validated on the admin path.
// No `enabled` flag since 3.0 (#297): the card shows while its layout row does.
export const feedSchema = z.object({
  // The feed URLs to merge, rendered newest-first. The pre-1.9.6 single `url`
  // is folded into this list by the one-time shape migration
  // (lib/config-migrate.ts, ledger #152).
  urls: z.array(z.string()).default([]),
  count: z.number().int().min(1).max(15).default(6),
  // Card title override; empty uses the first feed's own title.
  title: z.string().default(""),
  // Show a short snippet of each entry under its headline; off keeps the
  // compact headline-only list.
  summaries: z.boolean().default(false),
});
export type FeedConfig = z.infer<typeof feedSchema>;

// The effective feed URL list: `urls` with blank entries trimmed out. Shared by
// the home page, the admin editor's seed, and the fetch layer so a half-typed
// row is skipped in exactly one way.
export function feedUrls(feed: Pick<FeedConfig, "urls">): string[] {
  return feed.urls.map((u) => u.trim()).filter((u) => u !== "");
}
