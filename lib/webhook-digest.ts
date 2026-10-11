// Holding a burst of inbound webhooks for one notification (#346, #359). A
// season import lands as one Sonarr event per episode, seconds apart; relayed
// one by one they are eight pings for one thing. The hook route hands an
// event that names a digest (lib/webhooks.ts, `notification.digest`) to
// holdForDigest instead of sending it; events gather in a group whose timer
// slides with every arrival, and when the burst goes quiet for one window —
// or has run for five windows, ten minutes at most, so a trickle can't hold
// a notification forever — the group is sent once.
//
// What shares a group is the scope (#359): like events only (the digest's
// key: the service, the sender's instance, the event type and, for a Sonarr
// series, the series), everything one sender posts (the digest's `sender`),
// or everything at all. Inside a group each key is still its own burst,
// merged by mergeDigest(); a group holding several is folded into one
// notification by mergeDigests(), one line per burst. Delivery is a callback
// the route supplies, so this module knows nothing of channels or config and
// the tests run it on fake timers alone.
//
// State lives on globalThis (lib/singleton.ts: lib/* forks per Next bundle)
// and holds only parsed strings, never a raw payload. It is not persisted:
// pending groups die with the process — a stop or restart doesn't wait for a
// timer to fire — the same best-effort model as the poller's warning state
// and the push pings, and the help page says so.
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";
import type { DigestScope } from "./schema";
import { keyForLog, mergeDigests, type DigestGroup, type DigestItem, type WebhookNotification } from "./webhooks";

export type DigestSend = (c: WebhookNotification) => Promise<void>;

// Bounds. A whole-series import can run to hundreds of events; past the kept
// cap the rest are counted, not kept — by id, so a repeat of one counts once
// (the ids kept for that are bounded too, far past any honest burst; past
// them a repeat counts again) — and so are the items past the per-event
// read cap, so the merged title stays honest ("and 40 more") without the
// burst growing with the events. The hard cap keeps a steady drip from
// sliding the window forever. The group cap bounds the store itself: a key
// is the sender's text (an event type, a title), so one sender could open a
// group per event; past this many pending, a new key is not held and the
// caller relays its event at once. Sixty-four is far past the honest case —
// a few series importing at once, each its own group. Under a wider scope a
// group holds several bursts, bounded the same way: past the burst cap a
// new key inside it is relayed at once too.
const MAX_EVENT_ITEMS = 200;
const MAX_ITEMS = 100;
const MAX_DROPPED_IDS = 10 * MAX_ITEMS;
const MAX_GROUPS = 64;
const MAX_BURSTS = 32;
const CAP_WINDOWS = 5;
const MAX_CAP_MS = 10 * 60 * 1000;

// One key's events inside a group.
type Burst = {
  first: WebhookNotification;
  // The latest event: what goes out when every event was about one item.
  last: WebhookNotification;
  events: number;
  items: Map<string, DigestItem>;
  dropped: number;
  // The ids counted past the kept cap, so a repeat of one counts once.
  droppedIds: Set<string>;
};

type Group = {
  key: string;
  firstAt: number;
  bursts: Map<string, Burst>;
  // Unset only between opening the group and arming it, a few lines apart.
  timer?: ReturnType<typeof setTimeout>;
  send: DigestSend;
};

const state = globalSingleton("__ctrlcenterWebhookDigest", () => ({
  groups: new Map<string, Group>(),
}));

// The group an event joins under a scope: its own key, its sender's, or the
// one group everything shares.
function groupKey(d: NonNullable<WebhookNotification["digest"]>, scope: DigestScope): string {
  return scope === "all" ? "*" : scope === "app" ? d.sender : d.key;
}

// Add an event to its group, opening one when none is pending, and (re)arm
// the group's timer: one window from now, but never past the cap counted
// from the group's first event. The group keeps the delivery callback it was
// opened with. A later event about a kept item (same id — an upgrade of an
// episode just imported, a resend) replaces it in place and, when it stays
// its burst's only item, is what goes out in place of the first.
// Returns whether the event is held: not when it names no digest, nor when
// its group is new and MAX_GROUPS groups are pending, nor when its key is
// new to a group already holding MAX_BURSTS — the caller then relays it at
// once, as with the window off.
export function holdForDigest(
  n: WebhookNotification,
  o: { windowMs: number; send: DigestSend; scope?: DigestScope }
): boolean {
  const d = n.digest;
  if (!d) return false;
  const now = Date.now();
  const gkey = groupKey(d, o.scope ?? "event");
  let g = state.groups.get(gkey);
  if (!g) {
    if (state.groups.size >= MAX_GROUPS) return false;
    g = { key: gkey, firstAt: now, bursts: new Map(), send: o.send };
    state.groups.set(gkey, g);
  }
  let b = g.bursts.get(d.key);
  if (b) {
    b.events += 1;
    b.last = n;
  } else {
    if (g.bursts.size >= MAX_BURSTS) return false;
    b = { first: n, last: n, events: 1, items: new Map(), dropped: 0, droppedIds: new Set() };
    g.bursts.set(d.key, b);
  }
  clearTimeout(g.timer);
  for (const it of d.items.slice(0, MAX_EVENT_ITEMS)) {
    if (b.items.has(it.id) || b.items.size < MAX_ITEMS) b.items.set(it.id, it);
    else if (!b.droppedIds.has(it.id)) {
      if (b.droppedIds.size < MAX_DROPPED_IDS) b.droppedIds.add(it.id);
      b.dropped += 1;
    }
  }
  // Items past the per-event read cap were never looked at, so they can't
  // be deduped, but they count: the merged title says how many there were.
  if (d.items.length > MAX_EVENT_ITEMS) b.dropped += d.items.length - MAX_EVENT_ITEMS;
  const capMs = Math.min(o.windowMs * CAP_WINDOWS, MAX_CAP_MS);
  const due = Math.min(now + o.windowMs, g.firstAt + capMs);
  g.timer = setTimeout(() => void flush(gkey), Math.max(0, due - now));
  // Never hold the process open for a pending digest (lib/fetch-body.ts does
  // the same for its timeouts); a shutdown drops it, as documented above.
  g.timer.unref?.();
  return true;
}

// Send a group and forget it. The group leaves the map before the send, so
// an event arriving during a slow delivery opens a fresh group rather than
// joining one already on its way out. A failed send is logged once, not
// retried — the same as every channel delivery.
async function flush(key: string): Promise<void> {
  const g = state.groups.get(key);
  if (!g) return;
  state.groups.delete(key);
  const bursts: DigestGroup[] = [...g.bursts.values()].map((b) => ({
    first: b.first,
    last: b.last,
    events: b.events,
    items: [...b.items.values()],
    dropped: b.dropped,
  }));
  const merged = mergeDigests(bursts);
  const events = bursts.reduce((sum, b) => sum + b.events, 0);
  const items = bursts.reduce((sum, b) => sum + b.items.length + b.dropped, 0);
  // The key's segments are payload text: a log line gets its short form.
  const logged = keyForLog(key);
  try {
    await g.send(merged);
    log.info("webhook digest relayed", { key: logged, events, items });
  } catch (e) {
    log.warn("webhook digest failed", { key: logged, reason: errorReason(e) });
  }
}

// What is waiting, by group key and item count. For the route tests.
export function pendingWebhookDigests(): { key: string; count: number }[] {
  return [...state.groups.values()].map((g) => ({
    key: g.key,
    count: [...g.bursts.values()].reduce((sum, b) => sum + b.items.size + b.dropped, 0),
  }));
}

// Drop every pending group without sending. For tests.
export function resetWebhookDigest(): void {
  for (const g of state.groups.values()) clearTimeout(g.timer);
  state.groups.clear();
}
