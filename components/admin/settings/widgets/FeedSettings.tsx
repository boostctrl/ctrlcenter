"use client";

import { MAX_FEED_CARDS } from "@/lib/schema";
import { AddButton, Card, Hint } from "../../ui";
import { useFeedHealth } from "../../FeedHealth";
import { FeedCardEditor } from "../FeedCardEditor";
import type { SettingsDraft } from "../useSettingsDraft";

// The RSS feed card in admin Settings → Widgets (#285).
export default function FeedSettings({ d }: { d: SettingsDraft }) {
  const { feeds, updateFeedCard, addFeedCard, removeFeedCard, moveFeedCard } = d;
  // Health covers every URL the home page has fetched; each card reads its own
  // rows out of it. Poll while any card is enabled.
  const feedHealth = useFeedHealth(feeds.some((f) => f.enabled));
  return (
    <Card
      title="RSS feed"
      intro="Show the latest entries from one or more RSS, Atom, or JSON feeds, merged newest-first. Add several cards for topical sources — news, releases, blogs — each placed separately in the home-page layout editor. Fetched server-side and cached for a few minutes; cards ship hidden until you show them."
    >
      <div className="flex flex-col gap-3">
        {feeds.map((f, i) => (
          <FeedCardEditor
            key={f.id}
            feed={f}
            index={i}
            count={feeds.length}
            health={feedHealth}
            onChange={(next) => updateFeedCard(f.id, next)}
            onRemove={() => removeFeedCard(f.id)}
            onMove={moveFeedCard}
          />
        ))}
        {feeds.length < MAX_FEED_CARDS && (
          <AddButton onClick={addFeedCard}>+ Add feed card</AddButton>
        )}
        <Hint>
          Within a card, several feeds merge newest-first and each entry
          shows its source. Add separate cards to place feeds independently
          on the dashboard.
        </Hint>
      </div>
    </Card>
  );
}
