// Holding a burst of like inbound webhooks for one notification (#346). A
// season import lands as one Sonarr event per episode, seconds apart; relayed
// one by one they are eight pings for one thing. The hook route hands an
// event that names a digest (lib/webhooks.ts, `notification.digest`) to
// holdForDigest instead of sending it; events sharing the key gather in a
// group whose timer slides with every arrival, and when the burst goes quiet
// for one window — or has run for five windows, ten minutes at most, so a
// trickle can't hold a notification forever — the group is sent once,
// merged by mergeDigest(). Delivery is a callback the route supplies, so this
// module knows nothing of channels or config and the tests run it on fake
// timers alone.
//
// State lives on globalThis (lib/singleton.ts: lib/* forks per Next bundle)
// and holds only parsed strings, never a raw payload. It is not persisted:
// pending groups die with the process — a stop or restart doesn't wait for a
// timer to fire — the same best-effort model as the poller's warning state
// and the push pings, and the help page says so.
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";
import { mergeDigest, type DigestItem, type WebhookNotification } from "./webhooks";

export type DigestSend = (c: WebhookNotification) => Promise<void>;

// Bounds. A whole-series import can run to hundreds of events; past the kept
// cap the rest are counted, not kept, so the merged title stays honest ("and
// 40 more") without the group growing with the burst. The hard cap keeps a
// steady drip from sliding the window forever.
const MAX_EVENT_ITEMS = 200;
const MAX_ITEMS = 100;
const CAP_WINDOWS = 5;
const MAX_CAP_MS = 10 * 60 * 1000;

type Group = {
  key: string;
  first: WebhookNotification;
  events: number;
  firstAt: number;
  items: Map<string, DigestItem>;
  dropped: number;
  // Unset only between opening the group and arming it, a few lines apart.
  timer?: ReturnType<typeof setTimeout>;
  send: DigestSend;
};

const state = globalSingleton("__ctrlcenterWebhookDigest", () => ({
  groups: new Map<string, Group>(),
}));

// Add an event to its group, opening one when none is pending, and (re)arm
// the group's timer: one window from now, but never past the cap counted
// from the group's first event. The group keeps the delivery callback it was
// opened with. A resent item (same id) replaces the kept one in place.
export function holdForDigest(
  n: WebhookNotification,
  o: { windowMs: number; send: DigestSend }
): void {
  const d = n.digest;
  if (!d) return;
  const now = Date.now();
  let g = state.groups.get(d.key);
  if (g) {
    clearTimeout(g.timer);
    g.events += 1;
  } else {
    g = { key: d.key, first: n, events: 1, firstAt: now, items: new Map(), dropped: 0, send: o.send };
    state.groups.set(d.key, g);
  }
  for (const it of d.items.slice(0, MAX_EVENT_ITEMS)) {
    if (g.items.has(it.id) || g.items.size < MAX_ITEMS) g.items.set(it.id, it);
    else g.dropped += 1;
  }
  const capMs = Math.min(o.windowMs * CAP_WINDOWS, MAX_CAP_MS);
  const due = Math.min(now + o.windowMs, g.firstAt + capMs);
  const key = d.key;
  g.timer = setTimeout(() => void flush(key), Math.max(0, due - now));
  // Never hold the process open for a pending digest (lib/fetch-body.ts does
  // the same for its timeouts); a shutdown drops it, as documented above.
  g.timer.unref?.();
}

// Send a group and forget it. The group leaves the map before the send, so
// an event arriving during a slow delivery opens a fresh group rather than
// joining one already on its way out. A failed send is logged once, not
// retried — the same as every channel delivery.
async function flush(key: string): Promise<void> {
  const g = state.groups.get(key);
  if (!g) return;
  state.groups.delete(key);
  const merged = mergeDigest({
    first: g.first,
    events: g.events,
    items: [...g.items.values()],
    dropped: g.dropped,
  });
  try {
    await g.send(merged);
    log.info("webhook digest relayed", { key, events: g.events, items: g.items.size + g.dropped });
  } catch (e) {
    log.warn("webhook digest failed", { key, reason: errorReason(e) });
  }
}

// What is waiting, by key and item count. For the route tests.
export function pendingWebhookDigests(): { key: string; count: number }[] {
  return [...state.groups.values()].map((g) => ({ key: g.key, count: g.items.size + g.dropped }));
}

// Drop every pending group without sending. For tests.
export function resetWebhookDigest(): void {
  for (const g of state.groups.values()) clearTimeout(g.timer);
  state.groups.clear();
}
