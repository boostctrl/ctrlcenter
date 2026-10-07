// Process-wide singletons for server-side lib state (caches, in-flight maps,
// write queues, session cookies). Next bundles lib/* separately per route
// entry — and instrumentation.ts's background poller gets its own module graph
// too — so a plain module-level `const cache = new Map()` would give every API
// route and page its own copy: a poller's writes the reader never sees, a
// "serialized" write queue that interleaves across endpoints, a cache that
// misses once per route. Hanging the value off globalThis gives every bundle
// in the process the same instance.
//
// `key` is the globalThis property name and is shared across bundles (and
// reached into by some tests), so never rename an existing one. The first
// caller's `init` wins; later callers get that instance back unchanged.
export function globalSingleton<T>(key: `__ctrlcenter${string}`, init: () => T): T {
  const g = globalThis as unknown as Record<string, T | undefined>;
  return (g[key] ??= init());
}
