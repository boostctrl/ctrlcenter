import SectionTitle from "../SectionTitle";
import type { Feed } from "@/lib/feed";

// Home-page RSS/Atom feed section. Server-rendered (like CalendarWidget) with
// the items fetched in app/page.tsx; item text renders as plain React text and
// only http(s) links are ever linked (lib/feed.ts enforces both). Renders its
// empty/error state rather than nothing so a misconfigured feed stays
// discoverable; page.tsx passes null when the feature is off.

// Day-level label, fixed to UTC: feed dates are day-granular and this is a
// server component, so a visitor-zone conversion isn't available (and the
// off-by-a-few-hours case only shifts which day label a midnight post gets).
function dateLabel(ms: number | null): string | null {
  if (ms == null) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export default function FeedWidget({
  feed,
  titleOverride,
  showTitle = true,
  showSummaries = false,
}: {
  feed: Feed | null;
  titleOverride: string;
  // Show the section heading; the layout editor's label toggle turns it off.
  showTitle?: boolean;
  // Render each item's snippet under its headline (Settings → RSS feed).
  showSummaries?: boolean;
}) {
  const title = titleOverride.trim() || feed?.title.trim() || "Feed";
  return (
    <section>
      {showTitle && <SectionTitle>{title}</SectionTitle>}
      <div className="glass-card p-6">
        {feed && feed.items.length > 0 ? (
          <ul className="divide-y divide-fg/10">
            {feed.items.map((item, i) => {
              const date = dateLabel(item.publishedAt);
              const row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg/80">
                      {item.title}
                    </span>
                    {showSummaries && item.summary && (
                      <span className="line-clamp-2 text-xs leading-snug text-fg/55">
                        {item.summary}
                      </span>
                    )}
                    {item.source && (
                      <span className="block truncate text-xs text-fg/40">
                        {item.source}
                      </span>
                    )}
                  </span>
                  {date && (
                    <span className="shrink-0 text-xs text-fg/40 tabular-nums">
                      {date}
                    </span>
                  )}
                </>
              );
              return (
                <li key={`${item.url}-${i}`} className="py-2 first:pt-0 last:pb-0">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-baseline gap-3 transition-colors hover:text-fg"
                    >
                      {row}
                    </a>
                  ) : (
                    <span className="flex items-baseline gap-3">{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-fg/45">
            Couldn&apos;t load the feed right now.
          </p>
        )}
      </div>
    </section>
  );
}
