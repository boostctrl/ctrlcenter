// The uptime history's state and persistence (#290 split): the in-memory
// model the poller records into and the queries read, and its SQLite
// persistence (./db.ts, #278). The background poller (instrumentation.ts)
// records one up/down tally per app per hour; we keep 90 days of hourly
// buckets in memory as the read model and persist each poll's changes to a
// database beside config.yaml.
import fs from "fs/promises";
import path from "path";
import { log, errorReason } from "../log";
import type { StatusResult } from "../status";
import type { BundledOutageNote } from "../schema";
import { globalSingleton } from "../singleton";
import {
  openHistoryDb,
  readHistoryRows,
  readMeta,
  writeHistoryChanges,
  type DatabaseSync,
  type HistoryChanges,
  type HistoryRows,
  type ReadingRow,
} from "./db";
import {
  HOUR_MS,
  RETENTION_HOURS,
  RECENT_KEEP_MS,
  hourOf,
  type Bucket,
  type Reading,
  type RecordedOutage,
} from "./aggregate";

// Completed-outage records kept per app (#175). Records follow the same 90-day
// retention as the buckets; the count cap only exists so a service flapping
// every poll can't grow the file without bound. Oldest records fall off first,
// and anything dropped degrades gracefully to the hour-bucket reconstruction.
const MAX_OUTAGES = 500;
const HISTORY_DB = "status-history.db";
// What builds before #278 wrote; imported once into the database.
const LEGACY_HISTORY_FILE = "status-history.json";

type AppBuckets = Map<
  number,
  { up: number; down: number; maint: number; msCount: number; msSum: number; msMax: number }
>;
type HistoryState = {
  store: Map<string, AppBuckets>;
  recent: Map<string, Reading[]>; // raw readings (last ~90 min) for the 1h view
  // Start instant (ms) of each app's *current* outage, held only for apps that
  // were down at the last poll. Set at the transition into down and cleared on
  // recovery (see recordResults), so it answers "how long has it been down?"
  // rather than "when was the last down poll?".
  downSince: Map<string, number>;
  // Completed outages per app (#175), oldest first: the exact {start, end}
  // pairs the poller persisted at each recovery. See RecordedOutage.
  outages: Map<string, RecordedOutage[]>;
  // When each app with history was first seen missing from the config. Pruning
  // waits PRUNE_GRACE_MS past this, so undoing a delete (#307) finds the
  // app's history still there.
  missingSince: Map<string, number>;
  loaded: boolean;
  // The in-flight (or finished) load, shared by every caller — see loadHistory.
  loading?: Promise<void>;
  flushQueue: Promise<unknown>;
  // What changed since the last flush — all flush() writes (#278).
  dirty: Dirty;
  // The open database, with the path it was opened for (CONFIG_PATH decides).
  db?: { file: string; handle: DatabaseSync };
};

type Dirty = {
  buckets: Set<string>; // bucketKey(id, hour)
  readings: ReadingRow[];
  downSince: Set<string>;
  outages: Set<string>;
  dropped: Set<string>;
};
const emptyDirty = (): Dirty => ({
  buckets: new Set(),
  readings: [],
  downSince: new Set(),
  outages: new Set(),
  dropped: new Set(),
});
const bucketKey = (id: string, hour: number) => `${hour}\u0000${id}`;

// Held on globalThis so the background poller (instrumentation.ts) and the API
// route share ONE instance even if Next bundles them into separate module
// graphs — otherwise the reader loads the file once and never sees the poller's
// ongoing writes ("one reading, then frozen").
const state = globalSingleton<HistoryState>("__ctrlcenterStatusHistory", () => ({
  store: new Map(),
  recent: new Map(),
  downSince: new Map(),
  outages: new Map(),
  missingSince: new Map(),
  loaded: false,
  flushQueue: Promise.resolve(),
  dirty: emptyDirty(),
}));
state.recent ??= new Map(); // tolerate a state created by an older build
state.downSince ??= new Map(); // ditto — added after the recent ring
state.outages ??= new Map(); // ditto — added with the recorded outages (#175)
state.missingSince ??= new Map(); // ditto — added with the prune grace (#307)
state.dirty ??= emptyDirty(); // ditto — added with the database (#278)

function historyDir(): string {
  // Untraced like CONFIG_PATH (lib/config.ts): a runtime path, not a build input.
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.dirname(configPath);
}

// The database for the current CONFIG_PATH, opened on first use. Throws when
// it can't be opened (unwritable directory, a newer schema, a damaged file).
function historyDb(): DatabaseSync {
  const file = path.join(historyDir(), HISTORY_DB);
  if (state.db?.file === file) return state.db.handle;
  state.db?.handle.close();
  state.db = undefined;
  const handle = openHistoryDb(file);
  state.db = { file, handle };
  return handle;
}

// SQLite's "not a database" and "malformed" result codes.
const isDamaged = (e: unknown) =>
  typeof e === "object" && e !== null && [11, 26].includes((e as { errcode?: number }).errcode ?? 0);

// Load the persisted history into memory once (idempotent).
export function loadHistory(): Promise<void> {
  // Every caller awaits the same load: a request (or the poller's first tick)
  // arriving while the history is still being read must wait for it, not see
  // an empty store.
  state.loading ??= readHistory();
  return state.loading;
}

async function readHistory(): Promise<void> {
  if (state.loaded) return;
  state.loaded = true;
  // Memory is about to mirror the database; pending changes are moot.
  state.dirty = emptyDirty();
  applyRows({ buckets: [], readings: [], downSince: [], outages: [] });
  await fs.mkdir(historyDir(), { recursive: true }).catch(() => undefined);
  let db: DatabaseSync;
  try {
    db = historyDb();
    await importLegacyOnce(db);
  } catch (e) {
    if (!isDamaged(e)) {
      // Unwritable, or from a newer version: run on in memory, and say why
      // (each flush will too) rather than touch a file we don't understand.
      log.warn("status history unavailable", { reason: errorReason(e) });
      return;
    }
    // A damaged file can't be read by anyone: set it aside, start afresh.
    const file = path.join(historyDir(), HISTORY_DB);
    state.db?.handle.close();
    state.db = undefined;
    const aside = `${file}.damaged-${Date.now()}`;
    await fs.rename(file, aside).catch(() => undefined);
    log.warn("status history was damaged; starting a new one", { savedAs: aside });
    try {
      db = historyDb();
      await importLegacyOnce(db);
    } catch (e2) {
      log.warn("status history unavailable", { reason: errorReason(e2) });
      return;
    }
  }
  const now = Date.now();
  applyRows(
    readHistoryRows(db, {
      minReadingT: now - RECENT_KEEP_MS,
      minOutageEnd: now - RETENTION_HOURS * HOUR_MS,
    })
  );
}

// Replace the in-memory history with `rows`.
function applyRows(rows: HistoryRows): void {
  const store = new Map<string, AppBuckets>();
  for (const b of rows.buckets) {
    let m = store.get(b.app);
    if (!m) store.set(b.app, (m = new Map()));
    m.set(b.hour, {
      up: b.up,
      down: b.down,
      maint: b.maint ?? 0,
      msCount: b.msCount,
      msSum: b.msSum,
      msMax: b.msMax,
    });
  }
  const recent = new Map<string, Reading[]>();
  for (const r of rows.readings) {
    const reading: Reading = { t: r.t, up: r.up };
    if (r.ms != null) reading.ms = r.ms;
    if (r.maint) reading.maint = true;
    const list = recent.get(r.app);
    if (list) list.push(reading);
    else recent.set(r.app, [reading]);
  }
  const outages = new Map<string, RecordedOutage[]>();
  for (const o of rows.outages) {
    const rec: RecordedOutage = { start: o.start, end: o.end };
    if (o.note) rec.note = o.note;
    const list = outages.get(o.app);
    if (list) list.push(rec);
    else outages.set(o.app, [rec]);
  }
  state.store = store;
  state.recent = recent;
  state.downSince = new Map(rows.downSince.map((d) => [d.app, d.since]));
  state.outages = outages;
}

// The first time a database is opened, carry over the JSON history an older
// build wrote (if any), in the same transaction that marks the import done.
// The JSON file is left in place, so going back to an older version still
// finds its history (as of the upgrade).
async function importLegacyOnce(db: DatabaseSync): Promise<void> {
  if (readMeta(db, "legacyImport") !== undefined) return;
  let rows: HistoryRows = { buckets: [], readings: [], downSince: [], outages: [] };
  let found = false;
  try {
    const raw = await fs.readFile(path.join(historyDir(), LEGACY_HISTORY_FILE), "utf8");
    rows = parseLegacyHistory(JSON.parse(raw), Date.now());
    found = true;
  } catch {
    // No file, or one that doesn't parse — nothing to carry over.
  }
  const now = Date.now();
  writeHistoryChanges(db, {
    dropApps: [],
    buckets: rows.buckets,
    readings: rows.readings,
    downSince: rows.downSince,
    outages: groupOutages(rows.outages),
    ...retentionCutoffs(now),
    meta: { legacyImport: found ? `imported ${new Date(now).toISOString()}` : "none" },
  });
}

function groupOutages(rows: HistoryRows["outages"]): HistoryChanges["outages"] {
  const byApp = new Map<string, HistoryRows["outages"]>();
  for (const o of rows) byApp.set(o.app, [...(byApp.get(o.app) ?? []), o]);
  return [...byApp].map(([app, list]) => ({ app, list }));
}

function retentionCutoffs(now: number) {
  return {
    minHour: hourOf(now) - RETENTION_HOURS,
    minReadingT: now - RECENT_KEEP_MS,
    minOutageEnd: now - RETENTION_HOURS * HOUR_MS,
  };
}

// Parse the JSON history file older builds wrote. Stored shape:
// { apps:   { [id]: { [hour]: [up, down, msCount, msSum, msMax] } },
//   recent: { [id]: [[t, up?1:0, ms?], …] },
//   downSince: { [id]: ms },
//   outages: { [id]: [[start, end, note?], …] } }.
// The latency fields (msCount/msSum/msMax on a bucket, the third `ms` element on
// a recent entry), the `downSince` map, and the `outages` records (#175) were
// all added later, so they're optional: a file written before those features
// has 2-element bucket tuples, 2-element recent tuples, and no
// `downSince`/`outages` keys, and simply loads with no latency data (zeros /
// undefined), no outage marks, and no outage records. Readings and outages
// past their retention are dropped on the way in.
export function parseLegacyHistory(data: unknown, now: number): HistoryRows {
  const d = (data ?? {}) as {
    apps?: Record<string, Record<string, number[]>>;
    recent?: Record<string, number[][]>;
    downSince?: Record<string, unknown>;
    outages?: Record<string, unknown[][]>;
  };
  const rows: HistoryRows = { buckets: [], readings: [], downSince: [], outages: [] };
  for (const [app, hours] of Object.entries(d.apps ?? {})) {
    for (const [hk, v] of Object.entries(hours ?? {})) {
      rows.buckets.push({
        app,
        hour: Number(hk),
        up: v?.[0] ?? 0,
        down: v?.[1] ?? 0,
        msCount: v?.[2] ?? 0,
        msSum: v?.[3] ?? 0,
        msMax: v?.[4] ?? 0,
      });
    }
  }
  const cutoff = now - RECENT_KEEP_MS;
  for (const [app, list] of Object.entries(d.recent ?? {})) {
    for (const r of list ?? []) {
      if (!(r?.[0] >= cutoff)) continue;
      // Third element present only on up readings written by a newer build;
      // absent on old files and on down readings — those keep ms undefined.
      const reading: ReadingRow = { app, t: r[0], up: r[1] === 1 };
      if (r[2] != null) reading.ms = r[2];
      rows.readings.push(reading);
    }
  }
  // Current-outage marks. Absent on older files → no app is considered
  // mid-outage until the next down poll re-establishes it.
  for (const [app, since] of Object.entries(d.downSince ?? {}))
    if (typeof since === "number") rows.downSince.push({ app, since });
  // Recorded outages (#175). Absent on older files → those files' completed
  // outages surface via the ring/bucket fallbacks instead.
  const outageCutoff = now - RETENTION_HOURS * HOUR_MS;
  for (const [app, list] of Object.entries(d.outages ?? {})) {
    for (const o of list ?? []) {
      if (typeof o?.[0] !== "number" || typeof o?.[1] !== "number") continue;
      if (o[1] < outageCutoff) continue;
      const row: HistoryRows["outages"][number] = { app, start: o[0], end: o[1] };
      // Third element is the incident note (#176), present only when set.
      if (typeof o[2] === "string" && o[2] !== "") row.note = o[2];
      rows.outages.push(row);
    }
  }
  return rows;
}

// The most recent raw reading (up/down) per id, for ids that have one in the
// recent ring. The alert poller uses this to seed its state on startup so a
// restart doesn't re-alert an app that was already down. Call it BEFORE
// recordResults so it reflects the prior tick, not the one being recorded.
export function lastReadings(ids: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const id of ids) {
    // The last reading outside maintenance (#293): a maintenance window's
    // downs never reached the alert state, so they mustn't seed it either.
    const last = state.recent.get(id)?.findLast((r) => !r.maint);
    if (last) out.set(id, last.up);
  }
  return out;
}

// Tally one round of results into the current hour, pruning anything older than
// the retention window. `maintenance` holds the apps under an active maintenance window (#293):
// their down checks are tallied as maintenance, which stays out of uptime and
// never opens an outage (one already open stays open until the app is back).
export function recordResults(
  results: StatusResult[],
  at: number,
  maintenance: ReadonlySet<string> = new Set()
): void {
  const hour = hourOf(at);
  const cutoff = hour - RETENTION_HOURS;
  const recentCutoff = at - RECENT_KEEP_MS;
  for (const r of results) {
    let m = state.store.get(r.id);
    if (!m) {
      m = new Map();
      state.store.set(r.id, m);
    }
    const b = m.get(hour) ?? { up: 0, down: 0, maint: 0, msCount: 0, msSum: 0, msMax: 0 };
    const maint = !r.up && maintenance.has(r.id);
    if (r.up) {
      b.up++;
      // Latency is accumulated from up checks only. A down check's `ms` is its
      // time-to-failure — commonly the whole 5s request timeout — so folding it
      // into the average would drag every figure toward that ceiling and make a
      // flapping app look uniformly slow. msCount is bumped alongside msSum so
      // the average divides by the samples that actually contributed (never by
      // `up`, which on pre-upgrade hours counts checks with no ms recorded).
      b.msCount++;
      b.msSum += r.ms;
      if (r.ms > b.msMax) b.msMax = r.ms;
    } else if (maint) {
      b.maint++;
    } else {
      b.down++;
    }
    m.set(hour, b);
    state.dirty.buckets.add(bucketKey(r.id, hour));
    for (const k of m.keys()) if (k < cutoff) m.delete(k);

    // Raw ring for the 1h view, pruned to the keep window. ms rides along on up
    // readings only, matching the bucket accumulators; a down reading keeps ms
    // undefined so the read path never averages its time-to-failure.
    const reading: Reading = { t: at, up: r.up };
    if (r.up) reading.ms = r.ms;
    if (maint) reading.maint = true;
    const list = state.recent.get(r.id) ?? [];
    list.push(reading);
    state.dirty.readings.push({ app: r.id, ...reading });
    state.recent.set(
      r.id,
      list.filter((x) => x.t >= recentCutoff)
    );

    // Track the *current* outage's start. Stamp it only on the transition into
    // the down state — the `has` guard keeps consecutive down polls from
    // advancing the mark to the latest failure, so it stays the outage's start
    // — and clear it the moment the app answers, so the map holds exactly the
    // apps down right now. This is what lets the page say how long an app has
    // been down (see getHistory / AppHistory.downSince).
    //
    // The up transition is also where a completed outage becomes history
    // (#175): the mark and the recovery instant are persisted as an exact
    // {start, end} record, so the outage log never has to re-guess the bounds
    // from hourly tallies after the ring ages the readings out. If the server
    // was off when the app recovered, `at` is the first poll that saw it up
    // again — the closest observed bound, same as the mark's own semantics.
    if (r.up) {
      const since = state.downSince.get(r.id);
      if (since !== undefined) {
        const list = state.outages.get(r.id) ?? [];
        list.push({ start: since, end: at });
        state.outages.set(
          r.id,
          list
            .filter((o) => o.end >= at - RETENTION_HOURS * HOUR_MS)
            .slice(-MAX_OUTAGES)
        );
        state.downSince.delete(r.id);
        state.dirty.downSince.add(r.id);
        state.dirty.outages.add(r.id);
      }
    } else if (!maint && !state.downSince.has(r.id)) {
      state.downSince.set(r.id, at);
      state.dirty.downSince.add(r.id);
    }
  }
}

// How long an app must be gone from the config before its history is dropped:
// comfortably past the admin's Undo window (#307), short enough that a deleted
// app doesn't linger in the file.
export const PRUNE_GRACE_MS = 10 * 60 * 1000;

// Forget every app not in `keepIds` once it has been missing for
// PRUNE_GRACE_MS — its hourly buckets, recent readings, open-outage mark, and
// recorded outages. Called by the poller with the configured app list, so a
// deleted app's history isn't carried indefinitely. Returns how many apps were dropped.
export function pruneHistory(keepIds: readonly string[], now = Date.now()): number {
  const keep = new Set(keepIds);
  for (const id of state.missingSince.keys()) {
    if (keep.has(id)) state.missingSince.delete(id); // restored in time
  }
  const maps = [state.store, state.recent, state.downSince, state.outages];
  const gone = new Set<string>();
  for (const map of maps) {
    for (const id of map.keys()) {
      if (keep.has(id)) continue;
      const since = state.missingSince.get(id);
      if (since === undefined) state.missingSince.set(id, now);
      else if (now - since >= PRUNE_GRACE_MS) gone.add(id);
    }
  }
  for (const id of gone) {
    for (const map of maps) map.delete(id);
    state.missingSince.delete(id);
    forgetDirty(state.dirty, id);
    state.dirty.dropped.add(id);
  }
  return gone.size;
}

// Drop an app's pending changes (it's being deleted).
function forgetDirty(d: Dirty, id: string): void {
  for (const k of d.buckets) if (k.endsWith(`\u0000${id}`)) d.buckets.delete(k);
  d.readings = d.readings.filter((r) => r.app !== id);
  d.downSince.delete(id);
  d.outages.delete(id);
}

// Write what changed since the last flush, serialized and in one transaction
// (#278). On failure the changes are kept for the next flush to retry.
export function flush(): Promise<void> {
  state.flushQueue = state.flushQueue.then(() => {
    const dirty = state.dirty;
    state.dirty = emptyDirty();
    try {
      writeHistoryChanges(historyDb(), changesFrom(dirty, Date.now()));
    } catch (e) {
      mergeDirty(dirty);
      // Best-effort — history is non-critical and the next flush retries —
      // but leave a trace, or a full disk or read-only volume would silently
      // stop the uptime history from persisting.
      log.warn("status history write failed", { reason: errorReason(e) });
    }
  });
  return state.flushQueue as Promise<void>;
}

// The database writes for a set of changes, read from the in-memory model.
function changesFrom(d: Dirty, now: number): HistoryChanges {
  const buckets: HistoryChanges["buckets"] = [];
  for (const key of d.buckets) {
    const sep = key.indexOf("\u0000");
    const hour = Number(key.slice(0, sep));
    const app = key.slice(sep + 1);
    // Gone from memory means retention dropped it; so will the DELETE.
    const b = state.store.get(app)?.get(hour);
    if (b) buckets.push({ app, hour, ...b });
  }
  return {
    dropApps: [...d.dropped],
    buckets,
    readings: d.readings,
    downSince: [...d.downSince].map((app) => ({
      app,
      since: state.downSince.get(app) ?? null,
    })),
    outages: [...d.outages].map((app) => ({
      app,
      list: (state.outages.get(app) ?? []).map((o) => ({ app, ...o })),
    })),
    ...retentionCutoffs(now),
  };
}

// Put a failed flush's changes back in front of anything recorded since.
function mergeDirty(failed: Dirty): void {
  const now = state.dirty;
  for (const id of now.dropped) forgetDirty(failed, id);
  state.dirty = {
    buckets: new Set([...failed.buckets, ...now.buckets]),
    readings: [...failed.readings, ...now.readings],
    downSince: new Set([...failed.downSince, ...now.downSince]),
    outages: new Set([...failed.outages, ...now.outages]),
    dropped: new Set([...failed.dropped, ...now.dropped]),
  };
}

// Set, replace, or clear (empty string) the incident note on one recorded
// outage (#176), anchored by the app id + the record's exact start instant.
// Notes live with the outage records in the history database — server-recorded
// state, not config. The config export bundles them anyway (exportOutageNotes,
// #309), being the one part of the history no one can regenerate. Returns false when no record of `id`
// starts at `startMs` (unknown app, a legacy pre-#175 entry, or a record that
// aged out): there is nothing stable to anchor the note to. The caller flushes.
export function setOutageNote(
  id: string,
  startMs: number,
  note: string
): boolean {
  const rec = state.outages.get(id)?.find((o) => o.start === startMs);
  if (!rec) return false;
  if (note === "") delete rec.note;
  else rec.note = note;
  state.dirty.outages.add(id);
  return true;
}

// Every recorded outage that carries a note (#309), for the config export.
export function exportOutageNotes(): BundledOutageNote[] {
  const out: BundledOutageNote[] = [];
  for (const [app, list] of state.outages) {
    for (const o of list) if (o.note) out.push({ app, start: o.start, end: o.end, note: o.note });
  }
  return out;
}

// Restore exported notes (#309): onto the matching recorded outage when this
// instance has it, else as the recorded outage itself, so a move to a new host
// keeps the outage its note describes. Records past retention are skipped.
// Returns how many landed; the caller flushes.
export function importOutageNotes(notes: BundledOutageNote[], now = Date.now()): number {
  const cutoff = now - RETENTION_HOURS * HOUR_MS;
  let landed = 0;
  for (const n of notes) {
    if (n.end < cutoff) continue;
    const list = state.outages.get(n.app) ?? [];
    const rec = list.find((o) => o.start === n.start);
    if (rec) rec.note = n.note;
    else list.push({ start: n.start, end: n.end, note: n.note });
    state.outages.set(
      n.app,
      list.sort((a, b) => a.start - b.start).slice(-MAX_OUTAGES)
    );
    state.dirty.outages.add(n.app);
    landed++;
  }
  return landed;
}

// One app's stored data as plain arrays (empty when the id has none).
export function appData(id: string): { buckets: Bucket[]; readings: Reading[] } {
  const m = state.store.get(id);
  const buckets: Bucket[] = m
    ? [...m].map(([hour, b]) => ({
        hour,
        up: b.up,
        down: b.down,
        maint: b.maint,
        msCount: b.msCount,
        msSum: b.msSum,
        msMax: b.msMax,
      }))
    : [];
  return { buckets, readings: state.recent.get(id) ?? [] };
}


// Start of an app's current outage, or null when it was up at the last poll.
export function currentOutageStart(id: string): number | null {
  return state.downSince.get(id) ?? null;
}

// An app's recorded (completed) outages, oldest first.
export function recordedOutages(id: string): RecordedOutage[] {
  return state.outages.get(id) ?? [];
}
