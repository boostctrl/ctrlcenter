"use client";

import type { InstanceOf } from "@/lib/schema";
import { MAX_FEED_URLS } from "@/lib/schema";
import { AddButton, ListPanel, MoveButtons, NumberRow, RemoveButton, TextField, ToggleRow, controlClasses } from "../ui";
import FeedTest from "../FeedTest";
import { FeedHealthBadge } from "../FeedHealth";
import type { FeedHealth } from "@/lib/feed";
import { useKeyedRows } from "./useKeyedRows";

// One feed widget's fields in admin Settings → Widgets (#167, #297): its URL
// list (each row with a Test/autodiscover button and passive fetch-health
// badge), title, entry count and summaries toggle. The surrounding instance
// card (WidgetsSection) carries the name, show switch and Remove. Owns its
// URL-rows keying, so it must be its own component (hooks can't be called
// inside the parent's map).
export function FeedCardEditor({
  feed,
  label,
  health,
  onChange,
}: {
  feed: InstanceOf<"feed">;
  label: string;
  health: Record<string, FeedHealth> | null;
  onChange: (patch: Partial<InstanceOf<"feed">>) => void;
}) {
  const setUrls = (update: (prev: string[]) => string[]) => onChange({ urls: update(feed.urls) });
  const urlRows = useKeyedRows(feed.urls, setUrls);
  const updateUrl = (i: number, url: string) =>
    setUrls((urls) => urls.map((u, idx) => (idx === i ? url : u)));
  return (
    <>
      <ListPanel label="Feed URLs (RSS, Atom, or JSON Feed)">
        {feed.urls.map((url, i) => (
          <div key={urlRows.keys[i] ?? i} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              {feed.urls.length > 1 && (
                <MoveButtons
                  index={i}
                  count={feed.urls.length}
                  label={`${label} feed ${i + 1}`}
                  onMove={urlRows.move}
                />
              )}
              <input
                value={url}
                onChange={(e) => updateUrl(i, e.target.value)}
                placeholder="https://example.com/feed.xml"
                aria-label={`${label} URL ${i + 1}`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <RemoveButton
                label={`Remove ${label} feed ${i + 1}`}
                onClick={() => urlRows.removeAt(i)}
              />
            </div>
            {url.trim() !== "" && (
              <div className="flex flex-col gap-1.5">
                <FeedTest url={url} onPick={(picked) => updateUrl(i, picked)} />
                <FeedHealthBadge health={health?.[url.trim()]} />
              </div>
            )}
          </div>
        ))}
        {feed.urls.length < MAX_FEED_URLS && (
          <AddButton onClick={() => urlRows.add("")}>+ Add feed</AddButton>
        )}
      </ListPanel>
      <TextField
        label="Card title (optional — defaults to the first feed's own)"
        placeholder=""
        value={feed.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <NumberRow
        label="Entries to show"
        min={1}
        max={15}
        value={feed.count}
        onChange={(count) => onChange({ count })}
      />
      <ToggleRow
        label="Show summaries"
        hint="Add a short snippet from each entry under its headline."
        checked={feed.summaries}
        onChange={(summaries) => onChange({ summaries })}
      />
    </>
  );
}
