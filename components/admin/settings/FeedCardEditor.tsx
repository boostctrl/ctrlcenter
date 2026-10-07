"use client";

import type { FeedConfig } from "@/lib/schema";
import { MAX_FEED_URLS } from "@/lib/schema";
import { AddButton, ListPanel, MoveButtons, NumberRow, RemoveButton, Switch, TextField, ToggleRow, controlClasses, fieldLabelClasses, subCardClasses } from "../ui";
import FeedTest from "../FeedTest";
import { FeedHealthBadge } from "../FeedHealth";
import type { FeedHealth } from "@/lib/feed";
import { useKeyedRows } from "./useKeyedRows";

// One feed card in the RSS settings section (#167): its enable toggle, URL
// list (each row with a Test/autodiscover button and passive fetch-health
// badge), title, entry count, and summaries toggle. The board can hold several
// — each is a config instance the layout editor places independently — so the
// header carries a Move/Remove affordance and a label that falls back to the
// card's number. Owns its own URL-rows keying, so it must be its own component
// (hooks can't be called inside the parent's feeds.map).
export function FeedCardEditor({
  feed,
  index,
  count,
  health,
  onChange,
  onRemove,
  onMove,
}: {
  feed: FeedConfig;
  index: number;
  count: number;
  health: Record<string, FeedHealth> | null;
  onChange: (next: FeedConfig) => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const setUrls = (update: (prev: string[]) => string[]) =>
    onChange({ ...feed, urls: update(feed.urls) });
  const urlRows = useKeyedRows(feed.urls, setUrls);
  const updateUrl = (i: number, url: string) =>
    setUrls((urls) => urls.map((u, idx) => (idx === i ? url : u)));
  const label = feed.title.trim() || `Feed card ${index + 1}`;
  return (
    <div className={`${subCardClasses} flex flex-col gap-3 p-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {count > 1 && (
            <MoveButtons
              index={index}
              count={count}
              label={label}
              onMove={onMove}
            />
          )}
          <span className={`${fieldLabelClasses} truncate`}>{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer items-center">
            <Switch
              checked={feed.enabled}
              onChange={(enabled) => onChange({ ...feed, enabled })}
              label={`${label} enabled`}
            />
          </label>
          {count > 1 && (
            <RemoveButton label={`Remove ${label}`} onClick={onRemove} />
          )}
        </div>
      </div>
      {feed.enabled && (
        <>
          <ListPanel label="Feed URLs (RSS, Atom, or JSON Feed)">
            {feed.urls.map((url, i) => (
              <div
                key={urlRows.keys[i] ?? i}
                className="flex flex-col gap-1.5"
              >
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
                    <FeedTest
                      url={url}
                      onPick={(picked) => updateUrl(i, picked)}
                    />
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
            onChange={(e) => onChange({ ...feed, title: e.target.value })}
          />
          <NumberRow
            label="Entries to show"
            min={1}
            max={15}
            value={feed.count}
            onChange={(nextCount) => onChange({ ...feed, count: nextCount })}
          />
          <ToggleRow
            label="Show summaries"
            hint="Add a short snippet from each entry under its headline."
            checked={feed.summaries}
            onChange={(summaries) => onChange({ ...feed, summaries })}
          />
        </>
      )}
    </div>
  );
}
