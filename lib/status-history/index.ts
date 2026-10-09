// Persisted uptime history for the /status page, split by role (#290):
// aggregate.ts (pure helpers), store.ts (state + SQLite persistence),
// query.ts (the API payloads), db.ts (the SQLite schema and statements).
export * from "./aggregate";
export {
  loadHistory,
  lastReadings,
  recordResults,
  pruneHistory,
  PRUNE_GRACE_MS,
  flush,
  setOutageNote,
  exportOutageNotes,
  importOutageNotes,
  parseLegacyHistory,
} from "./store";
export * from "./query";
