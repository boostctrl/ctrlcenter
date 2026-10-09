// SQLite persistence for the uptime history (#278), on Node's built-in
// node:sqlite (no native dependency). ./store.ts keeps the whole
// history in memory as its read model; this file only loads it at startup and
// writes what changed since the last flush. That makes each poll a handful of
// upserts and inserts instead of re-serializing 90 days of buckets, and
// retention a DELETE.
//
// The database (status-history.db) lives beside config.yaml, where the JSON
// file used to. A file from an older build is imported once (see
// ./store.ts) and left where it is.
import { DatabaseSync } from "node:sqlite";

export type { DatabaseSync };

export type BucketRow = {
  app: string;
  hour: number;
  up: number;
  down: number;
  msCount: number;
  msSum: number;
  msMax: number;
};
export type ReadingRow = { app: string; t: number; up: boolean; ms?: number };
export type OutageRow = { app: string; start: number; end: number; note?: string };

export type HistoryRows = {
  buckets: BucketRow[];
  readings: ReadingRow[];
  downSince: { app: string; since: number }[];
  outages: OutageRow[];
};

// One flush's worth of changes. Apps in `dropApps` are deleted first, so a
// later upsert in the same flush still lands.
export type HistoryChanges = {
  dropApps: string[];
  // Changed hour buckets, upserted whole.
  buckets: BucketRow[];
  // Readings recorded since the last flush (append-only).
  readings: ReadingRow[];
  // Current-outage marks: a number sets it, null clears it.
  downSince: { app: string; since: number | null }[];
  // Each listed app's full outage list replaces what's stored (outages change
  // only on recovery or a note edit, and are capped, so this stays small).
  outages: { app: string; list: OutageRow[] }[];
  // Retention cut-offs.
  minHour: number;
  minReadingT: number;
  minOutageEnd: number;
  // Bookkeeping values to set in the same transaction.
  meta?: Record<string, string>;
};

const SCHEMA_VERSION = 1;

export function openHistoryDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    // WAL keeps a crash mid-flush from tearing the file; NORMAL sync is the
    // usual pairing (a power cut can lose the last flush, never corrupt).
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const { user_version: version } = db
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `status history database is from a newer version (schema ${version})`
      );
    }
    if (version < 1) {
      db.exec(`
        BEGIN;
        CREATE TABLE IF NOT EXISTS buckets (
          app TEXT NOT NULL, hour INTEGER NOT NULL,
          up INTEGER NOT NULL, down INTEGER NOT NULL,
          ms_count INTEGER NOT NULL, ms_sum INTEGER NOT NULL, ms_max INTEGER NOT NULL,
          PRIMARY KEY (app, hour)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS buckets_hour ON buckets (hour);
        -- No (app, t) key: one round may record an app more than once.
        CREATE TABLE IF NOT EXISTS readings (
          app TEXT NOT NULL, t INTEGER NOT NULL, up INTEGER NOT NULL, ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS readings_app_t ON readings (app, t);
        CREATE INDEX IF NOT EXISTS readings_t ON readings (t);
        CREATE TABLE IF NOT EXISTS down_since (
          app TEXT PRIMARY KEY, since INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outages (
          app TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, note TEXT
        );
        CREATE INDEX IF NOT EXISTS outages_app ON outages (app, start);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = ${SCHEMA_VERSION};
        COMMIT;
      `);
    }
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

export function readHistoryRows(
  db: DatabaseSync,
  cutoffs: { minReadingT: number; minOutageEnd: number }
): HistoryRows {
  const buckets = db
    .prepare(
      "SELECT app, hour, up, down, ms_count AS msCount, ms_sum AS msSum, ms_max AS msMax FROM buckets"
    )
    .all() as BucketRow[];
  const readings = (
    db
      .prepare("SELECT app, t, up, ms FROM readings WHERE t >= ? ORDER BY rowid")
      .all(cutoffs.minReadingT) as { app: string; t: number; up: number; ms: number | null }[]
  ).map((r) => {
    const row: ReadingRow = { app: r.app, t: r.t, up: r.up === 1 };
    if (r.ms != null) row.ms = r.ms;
    return row;
  });
  const downSince = db.prepare("SELECT app, since FROM down_since").all() as {
    app: string;
    since: number;
  }[];
  const outages = (
    db
      .prepare(
        "SELECT app, start, end, note FROM outages WHERE end >= ? ORDER BY app, start"
      )
      .all(cutoffs.minOutageEnd) as {
      app: string;
      start: number;
      end: number;
      note: string | null;
    }[]
  ).map((o) => {
    const row: OutageRow = { app: o.app, start: o.start, end: o.end };
    if (o.note) row.note = o.note;
    return row;
  });
  return { buckets, readings, downSince, outages };
}

export function readMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

// Apply one flush atomically: everything lands or nothing does.
export function writeHistoryChanges(db: DatabaseSync, c: HistoryChanges): void {
  db.exec("BEGIN");
  try {
    for (const table of ["buckets", "readings", "down_since", "outages"]) {
      const del = db.prepare(`DELETE FROM ${table} WHERE app = ?`);
      for (const app of c.dropApps) del.run(app);
    }
    const bucket = db.prepare(`
      INSERT INTO buckets (app, hour, up, down, ms_count, ms_sum, ms_max)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (app, hour) DO UPDATE SET
        up = excluded.up, down = excluded.down, ms_count = excluded.ms_count,
        ms_sum = excluded.ms_sum, ms_max = excluded.ms_max`);
    for (const b of c.buckets)
      bucket.run(b.app, b.hour, b.up, b.down, b.msCount, b.msSum, b.msMax);
    const reading = db.prepare("INSERT INTO readings (app, t, up, ms) VALUES (?, ?, ?, ?)");
    for (const r of c.readings) reading.run(r.app, r.t, r.up ? 1 : 0, r.ms ?? null);
    const setDown = db.prepare(
      "INSERT INTO down_since (app, since) VALUES (?, ?) ON CONFLICT (app) DO UPDATE SET since = excluded.since"
    );
    const clearDown = db.prepare("DELETE FROM down_since WHERE app = ?");
    for (const d of c.downSince) {
      if (d.since === null) clearDown.run(d.app);
      else setDown.run(d.app, d.since);
    }
    const clearOutages = db.prepare("DELETE FROM outages WHERE app = ?");
    const outage = db.prepare(
      "INSERT INTO outages (app, start, end, note) VALUES (?, ?, ?, ?)"
    );
    for (const { app, list } of c.outages) {
      clearOutages.run(app);
      for (const o of list) outage.run(app, o.start, o.end, o.note ?? null);
    }
    db.prepare("DELETE FROM buckets WHERE hour < ?").run(c.minHour);
    db.prepare("DELETE FROM readings WHERE t < ?").run(c.minReadingT);
    db.prepare("DELETE FROM outages WHERE end < ?").run(c.minOutageEnd);
    const meta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    );
    for (const [key, value] of Object.entries(c.meta ?? {})) meta.run(key, value);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
