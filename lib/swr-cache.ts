// One stale-while-revalidate cache for the server-side fetchers (#286): the
// calendar, the RSS feeds and the Monitor's integration snapshots each used to
// hand-roll the same map + in-flight dedupe + TTL + stale-on-failure logic.
//
// Semantics, per key:
// - cold (no entry): `get` awaits the load — the only case that blocks;
// - fresh (younger than the TTL): served as-is, nothing is fetched;
// - stale: served immediately while ONE background refresh runs (concurrent
//   readers share it);
// - the loader returns the new value, or `undefined` to keep the previous
//   entry untouched (stale-on-failure — the next read after the TTL retries).
//   It receives the previous entry, so it can revalidate conditionally (a 304
//   can return `prev.value` to re-arm the TTL) or carry old data beside an
//   error.
// - `delete` drops a key AND fences off any refresh already running for it, so
//   a fetch begun before an invalidation can't write its stale result back.
//
// State lives on globalThis (globalSingleton) because lib module state forks
// per route bundle; `name` keys it, so each cache must use a unique name.
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";

export type SwrEntry<V> = { value: V; at: number };
export type SwrLoader<V> = (prev: SwrEntry<V> | undefined) => Promise<V | undefined>;

type SwrState<V> = {
  entries: Map<string, SwrEntry<V>>;
  // A refresh writes only while it is still its key's registered run, so
  // delete() — which unregisters it — fences off its result.
  inFlight: Map<string, Promise<void>>;
};

export type SwrCache<V> = {
  // The value for `key`, loading it if needed (see the semantics above).
  // Undefined only when nothing has ever loaded. Never rejects.
  get(key: string, load: SwrLoader<V>): Promise<V | undefined>;
  // The current entry without loading anything.
  peek(key: string): SwrEntry<V> | undefined;
  // Drop one key (and fence off its in-flight refresh).
  delete(key: string): void;
  // Drop every key matching `match`.
  deleteWhere(match: (key: string) => boolean): void;
};

export function swrCache<V>(name: string, ttlMs: number): SwrCache<V> {
  const state = globalSingleton<SwrState<V>>(`__ctrlcenterSwr:${name}`, () => ({
    entries: new Map(),
    inFlight: new Map(),
  }));

  function refresh(key: string, load: SwrLoader<V>): Promise<void> {
    const running = state.inFlight.get(key);
    if (running) return running;
    // Deferred a microtask so `run` is assigned before the loader can settle
    // (a synchronously throwing loader would otherwise reach `finally` first).
    const run: Promise<void> = Promise.resolve().then(async () => {
      try {
        const value = await load(state.entries.get(key));
        if (value !== undefined && state.inFlight.get(key) === run) {
          state.entries.set(key, { value, at: Date.now() });
        }
      } catch (e) {
        // Loaders are expected to turn their own failures into `undefined` or a
        // value; a throw is a bug, so log it and keep the old entry.
        log.warn("cache refresh failed", { cache: name, reason: errorReason(e) });
      } finally {
        // Only clear our own slot: after a delete() a newer refresh may own it.
        if (state.inFlight.get(key) === run) state.inFlight.delete(key);
      }
    });
    state.inFlight.set(key, run);
    return run;
  }

  function drop(key: string) {
    state.entries.delete(key);
    state.inFlight.delete(key);
  }

  return {
    async get(key, load) {
      const cached = state.entries.get(key);
      if (!cached) {
        await refresh(key, load);
      } else if (Date.now() - cached.at >= ttlMs) {
        void refresh(key, load);
      }
      return (state.entries.get(key) ?? cached)?.value;
    },
    peek: (key) => state.entries.get(key),
    delete: drop,
    deleteWhere(match) {
      for (const key of [...state.entries.keys(), ...state.inFlight.keys()]) {
        if (match(key)) drop(key);
      }
    },
  };
}
