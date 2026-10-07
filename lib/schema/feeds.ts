// Multi-instance feed (RSS/Atom/JSON Feed) cards.
import { z } from "zod";
import { FEED_DEFAULT_ID } from "../layout";
import { lenientArray } from "./shared";

// Cap on how many feed URLs one widget can fan out to. Each is a separate
// server-side fetch per home-page render (the page is force-dynamic), so the
// list is bounded — generous for real use, a guard against a hand-edited or
// imported config turning the widget into an unbounded outbound-request source.
export const MAX_FEED_URLS = 10;

// Cap on how many feed cards (instances) the board can carry. Each is its own
// widget on the grid with its own URL list, so the real fan-out ceiling is
// MAX_FEED_CARDS × MAX_FEED_URLS — bounded like the URL list, against a
// hand-edited or imported config spawning unbounded cards.
export const MAX_FEED_CARDS = 8;

// One feed card (RSS/Atom/JSON Feed) fed by one or more public feed URLs,
// merged newest-first. Stored leniently; URLs are validated on the admin path.
// The board can hold several — each is a config instance keyed by `id`, placed
// on the grid by a layout entry whose instanceId matches (see lib/layout.ts).
export const feedSchema = z.object({
  // Stable instance id — the layout entry's instanceId points at it. The stock
  // single card uses FEED_DEFAULT_ID; added cards get a client-minted id.
  id: z.string().default(FEED_DEFAULT_ID),
  enabled: z.boolean().default(false),
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

// The configured feed cards. Defaults to a single stock instance so a fresh
// install (and a config predating the feature) still has one RSS card to set
// up. The pre-2.1 single `feed` object is folded into this list — as one
// instance keyed FEED_DEFAULT_ID — by the shape migration.
export const feedsSchema = lenientArray(feedSchema).default([
  feedSchema.parse({}),
]);
export type FeedsConfig = z.infer<typeof feedsSchema>;

// The effective feed URL list: `urls` with blank entries trimmed out. Shared by
// the home page, the admin editor's seed, and the fetch layer so a half-typed
// row is skipped in exactly one way.
export function feedUrls(feed: Pick<FeedConfig, "urls">): string[] {
  return feed.urls.map((u) => u.trim()).filter((u) => u !== "");
}

// The admin sends the whole feed-cards list. Each card carries its instance
// `id`. A card's URL list may be empty (it stays inert until set) and blank
// rows are allowed (trimmed on read), but every non-empty entry must be
// http(s). The list is capped at MAX_FEED_CARDS.
export const feedUpdateSchema = z
  .object({
    id: z.string(),
    enabled: z.boolean(),
    urls: z.array(z.string()).max(MAX_FEED_URLS),
    count: z.number().int().min(1).max(15),
    title: z.string(),
    summaries: z.boolean(),
  })
  .refine(
    (f) => f.urls.every((u) => u.trim() === "" || /^https?:\/\//i.test(u.trim())),
    { message: "Every feed URL must start with http(s)", path: ["urls"] }
  );

export const feedsUpdateSchema = z.array(feedUpdateSchema).max(MAX_FEED_CARDS);
