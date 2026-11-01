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
// the caller supplies — the hook route's (lib/webhook-relay.ts), and the one
// a group read back at startup gets — so this module knows nothing of
// channels or config, and the tests run it on fake timers and a scratch
// directory.
//
// An upgrade's delete folds into its import (#351): Sonarr deletes the file
// an upgrade replaces and posts that (EpisodeFileDelete, reason Upgrade)
// beside the import, which already says what it replaced. The parser pairs
// the two by key (`digest.foldInto` on the delete, `digest.folds` on the
// import); here a delete whose import is already pending is dropped, and an
// import's arrival takes the deletes it covers out of their burst, so a
// season upgrade is one notification, not an "upgraded 8" beside a "deleted
// 8". A delete whose import never comes goes out on its own.
//
// State lives on globalThis (lib/singleton.ts: lib/* forks per Next bundle)
// and holds only parsed strings, never a raw payload. The pending groups are
// spooled to `webhook-digest.json` beside config.yaml (#351) — rewritten as
// they change, removed when none are left — and read back at startup
// (instrumentation-node.ts, restoreWebhookDigests), each group re-armed for
// the time it was due, so a restart in the middle of a burst loses nothing
// and sends it once the process is back. A spool that can't be written is
// logged once, and the groups stay in memory as before it existed.
import fs from "node:fs/promises";
import path from "node:path";
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
// new key inside it is relayed at once too. The spool is bounded by the
// same caps, read back as well as written.
const MAX_EVENT_ITEMS = 200;
const MAX_ITEMS = 100;
const MAX_DROPPED_IDS = 10 * MAX_ITEMS;
const MAX_GROUPS = 64;
const MAX_BURSTS = 32;
const CAP_WINDOWS = 5;
const MAX_CAP_MS = 10 * 60 * 1000;

const FILE_NAME = "webhook-digest.json";
const FILE_VERSION = 1;

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
  // The event each kept item came from, in arrival order, so a burst that
  // loses items to an import (fold below) still stands for what is left by
  // one of its own events. Not spooled: a restored burst starts without and
  // keeps its first and last.
  sources: Map<string, WebhookNotification>;
};

type Group = {
  key: string;
  firstAt: number;
  // When the timer fires: spooled, so a restart re-arms the group for it.
  due: number;
  bursts: Map<string, Burst>;
  // Unset only between opening the group and arming it, a few lines apart.
  timer?: ReturnType<typeof setTimeout>;
  send: DigestSend;
};

const state = globalSingleton("__ctrlcenterWebhookDigest", () => ({
  groups: new Map<string, Group>(),
  // The spool write in flight, and whether the groups changed under it.
  writing: null as Promise<void> | null,
  dirty: false,
  persistFailed: false,
}));

// The group a burst key joins under a scope: its own, its sender's, or the
// one group everything shares.
function groupKeyOf(key: string, sender: string, scope: DigestScope): string {
  return scope === "all" ? "*" : scope === "app" ? sender : key;
}

// Whether a burst holds, kept or counted, every item of a digest.
function covers(b: Burst, items: DigestItem[]): boolean {
  return items.length > 0 && items.every((it) => b.items.has(it.id) || b.droppedIds.has(it.id));
}

// (Re)arm a group's timer: one window from now, but never past the cap
// counted from the group's first event.
function arm(g: Group, windowMs: number, now: number): void {
  const capMs = Math.min(windowMs * CAP_WINDOWS, MAX_CAP_MS);
  armAt(g, Math.min(now + windowMs, g.firstAt + capMs), now);
}

function armAt(g: Group, due: number, now: number): void {
  clearTimeout(g.timer);
  g.due = due;
  g.timer = setTimeout(() => void flush(g.key), Math.max(0, due - now));
  // Never hold the process open for a pending digest (lib/fetch-body.ts does
  // the same for its timeouts); a shutdown leaves it to the spool.
  g.timer.unref?.();
}

// Add an event to its group, opening one when none is pending, and (re)arm
// the group's timer. The group keeps the delivery callback it was opened
// with. A later event about a kept item (same id — an upgrade of an episode
// just imported, a resend) replaces it in place and, when it stays its
// burst's only item, is what goes out in place of the first.
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
  const scope = o.scope ?? "event";
  // An upgrade's delete whose import is already pending adds nothing to it:
  // it is the burst's own activity (the window slides) and is dropped.
  if (d.foldInto) {
    const g = state.groups.get(groupKeyOf(d.foldInto, d.sender, scope));
    const b = g?.bursts.get(d.foldInto);
    if (g && b && covers(b, d.items)) {
      arm(g, o.windowMs, now);
      return true;
    }
  }
  const gkey = groupKeyOf(d.key, d.sender, scope);
  let g = state.groups.get(gkey);
  if (!g) {
    if (state.groups.size >= MAX_GROUPS) return false;
    g = { key: gkey, firstAt: now, due: now, bursts: new Map(), send: o.send };
    state.groups.set(gkey, g);
  }
  let b = g.bursts.get(d.key);
  if (b) {
    b.events += 1;
    b.last = n;
  } else {
    if (g.bursts.size >= MAX_BURSTS) return false;
    b = { first: n, last: n, events: 1, items: new Map(), dropped: 0, droppedIds: new Set(), sources: new Map() };
    g.bursts.set(d.key, b);
  }
  for (const it of d.items.slice(0, MAX_EVENT_ITEMS)) {
    if (b.items.has(it.id) || b.items.size < MAX_ITEMS) {
      b.items.set(it.id, it);
      b.sources.set(it.id, n);
    } else if (!b.droppedIds.has(it.id)) {
      if (b.droppedIds.size < MAX_DROPPED_IDS) b.droppedIds.add(it.id);
      b.dropped += 1;
    }
  }
  // Items past the per-event read cap were never looked at, so they can't
  // be deduped, but they count: the merged title says how many there were.
  if (d.items.length > MAX_EVENT_ITEMS) b.dropped += d.items.length - MAX_EVENT_ITEMS;
  // An import's arrival makes the upgrade deletes it covers redundant.
  if (d.folds) fold(groupKeyOf(d.folds, d.sender, scope), d.folds, b);
  arm(g, o.windowMs, now);
  persist();
  return true;
}

// Take the upgrade deletes an import covers out of their burst (#351): a
// delete item marked an upgrade's, whose episode the import burst now
// holds, leaves; a burst left empty leaves its group, and a group left empty
// is forgotten. A delete of another episode, or for another reason, stays,
// and the burst's count and the events standing for it follow what is left,
// so one item left still goes out as its own event.
function fold(gkey: string, key: string, imports: Burst): void {
  const g = state.groups.get(gkey);
  const b = g?.bursts.get(key);
  if (!g || !b) return;
  let removed = 0;
  for (const [id, it] of b.items) {
    if (!it.upgrade || !(imports.items.has(id) || imports.droppedIds.has(id))) continue;
    b.items.delete(id);
    b.sources.delete(id);
    removed += 1;
  }
  if (!removed) return;
  if (!b.items.size && !b.dropped) {
    g.bursts.delete(key);
    if (!g.bursts.size) {
      clearTimeout(g.timer);
      state.groups.delete(gkey);
    }
    return;
  }
  b.events = Math.max(1, b.events - removed);
  const left = [...b.sources.values()];
  const stale = (n: WebhookNotification) => !n.digest?.items.some((it) => b.items.has(it.id));
  if (left.length && stale(b.first)) b.first = left[0];
  if (left.length && stale(b.last)) b.last = left[left.length - 1];
}

// Send a group and forget it. The group leaves the map (and the spool)
// before the send, so an event arriving during a slow delivery opens a
// fresh group rather than joining one already on its way out. A failed send
// is logged once, not retried — the same as every channel delivery.
async function flush(key: string): Promise<void> {
  const g = state.groups.get(key);
  if (!g) return;
  state.groups.delete(key);
  persist();
  const bursts: DigestGroup[] = [...g.bursts.values()].map((b) => ({
    first: b.first,
    last: b.last,
    events: b.events,
    items: [...b.items.values()],
    dropped: b.dropped,
  }));
  const events = bursts.reduce((sum, b) => sum + b.events, 0);
  const items = bursts.reduce((sum, b) => sum + b.items.length + b.dropped, 0);
  // The key's segments are payload text: a log line gets its short form.
  const logged = keyForLog(key);
  try {
    // Merged inside the try: a group read back from a spool someone edited
    // may not merge, and a timer's callback has no other catch.
    await g.send(mergeDigests(bursts));
    log.info("webhook digest relayed", { key: logged, events, items });
  } catch (e) {
    log.warn("webhook digest failed", { key: logged, reason: errorReason(e) });
  }
}

// --- The spool (#351) ---

// Resolved lazily (not at module load) so tests can point CONFIG_PATH at a
// scratch directory. Untraced like CONFIG_PATH in lib/config/store.ts.
function spoolPath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), FILE_NAME);
}

type SpoolBurst = {
  key: string;
  first: WebhookNotification;
  last: WebhookNotification;
  events: number;
  items: DigestItem[];
  dropped: number;
  droppedIds: string[];
};
type SpoolGroup = { key: string; firstAt: number; due: number; bursts: SpoolBurst[] };
type SpoolFile = { version: number; groups: SpoolGroup[] };

function snapshot(): SpoolFile {
  return {
    version: FILE_VERSION,
    groups: [...state.groups.values()].map((g) => ({
      key: g.key,
      firstAt: g.firstAt,
      due: g.due,
      bursts: [...g.bursts].map(([key, b]) => ({
        key,
        first: b.first,
        last: b.last,
        events: b.events,
        items: [...b.items.values()],
        dropped: b.dropped,
        droppedIds: [...b.droppedIds],
      })),
    })),
  };
}

// Write the groups to the spool, or remove it when none are pending. One
// write at a time, and a change during one queues one more, so a burst of
// arrivals costs a write or two, not one each. Never awaited by the hook
// route: a spool that can't be written is logged once, and the groups stay
// in memory.
function persist(): void {
  state.dirty = true;
  if (state.writing) return;
  state.writing = (async () => {
    while (state.dirty) {
      state.dirty = false;
      await writeSpool();
    }
    state.writing = null;
  })();
}

// The whole file atomically (temp + rename, mode 0600, like sessions.json).
async function writeSpool(): Promise<void> {
  const file = spoolPath();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    if (state.groups.size) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(snapshot()), { mode: 0o600 });
      await fs.rename(tmp, file);
    } else {
      await fs.rm(file, { force: true });
    }
    state.persistFailed = false;
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    if (!state.persistFailed) {
      log.warn(`can't spool pending webhook digests, they end with the process: ${errorReason(e)}`);
    }
    state.persistFailed = true;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const isItem = (v: unknown): v is DigestItem => isObj(v) && typeof v.id === "string" && typeof v.label === "string";

// A notification as the parsers make one: what the merger and the renderers
// read of it by shape is checked; the rest is text they clamp or ignore.
function isNotification(v: unknown): v is WebhookNotification {
  if (!isObj(v) || typeof v.title !== "string") return false;
  if (v.body !== undefined && typeof v.body !== "string") return false;
  if (v.url !== undefined && typeof v.url !== "string") return false;
  const r = v.report;
  if (r !== undefined && !(isObj(r) && typeof r.service === "string" && typeof r.event === "string" && Array.isArray(r.facts))) {
    return false;
  }
  const d = v.digest;
  if (d !== undefined && !(isObj(d) && typeof d.key === "string" && typeof d.lead === "string" && Array.isArray(d.items))) {
    return false;
  }
  return true;
}

function spoolBurst(v: unknown): SpoolBurst | undefined {
  if (!isObj(v) || typeof v.key !== "string" || !isNotification(v.first) || !isNotification(v.last)) return undefined;
  if (!isCount(v.events) || !isCount(v.dropped) || !Array.isArray(v.items) || !isStrings(v.droppedIds)) return undefined;
  const items = v.items.slice(0, MAX_ITEMS);
  if (!items.every(isItem)) return undefined;
  return {
    key: v.key,
    first: v.first,
    last: v.last,
    events: Math.max(1, v.events),
    items,
    dropped: v.dropped,
    droppedIds: v.droppedIds.slice(0, MAX_DROPPED_IDS),
  };
}

// The spool's groups, bounded as the store is; undefined when the file isn't
// a spool — edited by hand, or a version this build doesn't read.
function spoolGroups(v: unknown): SpoolGroup[] | undefined {
  if (!isObj(v) || v.version !== FILE_VERSION || !Array.isArray(v.groups)) return undefined;
  const groups: SpoolGroup[] = [];
  for (const g of v.groups.slice(0, MAX_GROUPS)) {
    if (!isObj(g) || typeof g.key !== "string" || !isTime(g.firstAt) || !isTime(g.due) || !Array.isArray(g.bursts)) {
      return undefined;
    }
    const bursts = g.bursts.slice(0, MAX_BURSTS).map(spoolBurst);
    if (!bursts.every((b): b is SpoolBurst => b !== undefined)) return undefined;
    groups.push({ key: g.key, firstAt: g.firstAt, due: g.due, bursts });
  }
  return groups;
}

// A spooled burst into a group: as its own when the key is new, else folded
// into the one pending under that key — its items under the kept cap, the
// live one kept where both have an id, the counts summed, and the spooled
// event, the older, as the burst's first.
function adopt(g: Group, sb: SpoolBurst): void {
  const b = g.bursts.get(sb.key);
  if (!b) {
    if (g.bursts.size >= MAX_BURSTS) return;
    g.bursts.set(sb.key, {
      first: sb.first,
      last: sb.last,
      events: sb.events,
      items: new Map(sb.items.map((it) => [it.id, it])),
      dropped: sb.dropped,
      droppedIds: new Set(sb.droppedIds),
      sources: new Map(),
    });
    return;
  }
  b.first = sb.first;
  b.events += sb.events;
  b.dropped += sb.dropped;
  for (const it of sb.items) {
    if (b.items.has(it.id)) continue;
    if (b.items.size < MAX_ITEMS) b.items.set(it.id, it);
    else b.dropped += 1;
  }
}

// Read the spool back after a restart and re-arm every group it holds for
// the time it was due — at once when that passed while the process was
// down — with `send` as its delivery. A missing spool is the usual case; an
// unreadable or corrupt one is logged and left alone (the next change
// rewrites it). A group already pending under a spooled key (an event beat
// the restore to it) takes the spooled bursts and keeps its own timer.
// Returns how many groups came back. For instrumentation-node.ts, once per
// process.
export async function restoreWebhookDigests(o: { send: DigestSend }): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(spoolPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`webhook digest spool unreadable, starting empty: ${errorReason(e)}`);
    }
    return 0;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log.warn(`webhook digest spool unparseable, starting empty: ${errorReason(e)}`);
    return 0;
  }
  const groups = spoolGroups(parsed);
  if (!groups) {
    log.warn("webhook digest spool isn't one, starting empty");
    return 0;
  }
  const now = Date.now();
  let restored = 0;
  for (const sg of groups) {
    let g = state.groups.get(sg.key);
    if (!g) {
      if (state.groups.size >= MAX_GROUPS) break;
      g = { key: sg.key, firstAt: sg.firstAt, due: sg.due, bursts: new Map(), send: o.send };
      state.groups.set(sg.key, g);
    }
    for (const sb of sg.bursts) adopt(g, sb);
    if (!g.bursts.size) {
      state.groups.delete(sg.key);
      continue;
    }
    if (!g.timer) armAt(g, Math.max(sg.due, now), now);
    restored += 1;
  }
  if (restored) log.info("webhook digests restored", { groups: restored });
  return restored;
}

// What is waiting, by group key and item count. For the route tests.
export function pendingWebhookDigests(): { key: string; count: number }[] {
  return [...state.groups.values()].map((g) => ({
    key: g.key,
    count: [...g.bursts.values()].reduce((sum, b) => sum + b.items.size + b.dropped, 0),
  }));
}

// The spool write in flight, if any: a test waits on it before reading the
// file, or before moving the scratch directory from under the store.
export function webhookDigestSpooled(): Promise<void> {
  return state.writing ?? Promise.resolve();
}

// Drop every pending group without sending, leaving the spool as it is — a
// simulated restart reads it back. For tests.
export function resetWebhookDigest(): void {
  for (const g of state.groups.values()) clearTimeout(g.timer);
  state.groups.clear();
  state.dirty = false;
  state.persistFailed = false;
}
