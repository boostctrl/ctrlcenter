// Alert state that has to outlast the process (#559), kept in
// `alert-state.json` beside config.yaml. Each source of alerts keeps a book
// of its own, keyed by what it watches: the apps' warnings (#310), which
// were announced once more after every restart or upgrade, and the API
// widgets' thresholds (#539); next the integrations' health (#540). An app's
// down/up state isn't here: it's rebuilt from the uptime history (#391,
// seedState in lib/alerts.ts).
//
// Small and seldom changed, so the whole file is rewritten when a book
// changes: atomically and 0600 (writeFileAtomic), one write at a time. A
// book from a newer version, or one this version no longer keeps, is carried
// along as it was read.
import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./config/files";
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";

const FILE_NAME = "alert-state.json";
const FILE_VERSION = 1;

// Bounds a book read back from a hand-edited or foreign file, or written by
// a source that watches more than it should.
export const MAX_BOOK_ENTRIES = 2000;

// The books, one per source of alerts: the apps' warnings, and the API
// widgets' thresholds (lib/widget-alerts.ts).
export type AlertBook = "warnings" | "thresholds";

type State = {
  // Each book as plain JSON, as it was read or last written, and its text,
  // which tells whether a write changed anything.
  books: Map<string, Record<string, unknown>>;
  texts: Map<string, string>;
  loaded: Promise<void> | null;
  dirty: boolean;
  writing: Promise<void> | null;
  failed: boolean;
};

const state = globalSingleton<State>("__ctrlcenterAlertBooks", () => ({
  books: new Map(),
  texts: new Map(),
  loaded: null,
  dirty: false,
  writing: null,
  failed: false,
}));

// Resolved lazily (not at module load) so tests can point CONFIG_PATH at a
// scratch directory. Untraced like CONFIG_PATH in lib/config/store.ts.
function statePath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(/* turbopackIgnore: true */ path.dirname(configPath), FILE_NAME);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

// Read the file back, once; every reader awaits this before its first
// readBook. A missing file starts every book empty, and so does one that
// can't be read, with a line in the log (the next write replaces it).
export function loadAlertState(): Promise<void> {
  state.loaded ??= (async () => {
    let text: string;
    try {
      text = await fs.readFile(statePath(), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn(`can't read the alert state, so open warnings may be announced again: ${errorReason(e)}`);
      }
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    if (!isObj(raw) || raw.version !== FILE_VERSION || !isObj(raw.books)) {
      log.warn(`${FILE_NAME} isn't one this version reads; starting the alert state afresh`);
      return;
    }
    for (const [name, book] of Object.entries(raw.books)) {
      if (!isObj(book)) continue;
      const kept = Object.fromEntries(Object.entries(book).slice(0, MAX_BOOK_ENTRIES));
      state.books.set(name, kept);
      state.texts.set(name, JSON.stringify(kept));
    }
  })();
  return state.loaded;
}

// One book's entries, keeping only those `valid` accepts: a hand-edited or
// older file can't hand a source a shape it doesn't expect.
export function readBook<T>(name: AlertBook, valid: (v: unknown) => v is T): Map<string, T> {
  const book = state.books.get(name) ?? {};
  return new Map(Object.entries(book).filter((e): e is [string, T] => valid(e[1])));
}

// Replace one book, and save the file when that changed it. Never throws and
// never waits: a file that can't be written is logged once, and the state
// carries on in memory.
export function writeBook<T>(name: AlertBook, entries: Map<string, T>): void {
  const text = JSON.stringify(Object.fromEntries([...entries].slice(0, MAX_BOOK_ENTRIES)));
  if (text === (state.texts.get(name) ?? "{}")) return;
  if (text === "{}") {
    state.books.delete(name);
    state.texts.delete(name);
  } else {
    state.books.set(name, JSON.parse(text) as Record<string, unknown>);
    state.texts.set(name, text);
  }
  persist();
}

// One write at a time, and a change during one queues one more.
function persist(): void {
  state.dirty = true;
  if (state.writing) return;
  state.writing = (async () => {
    while (state.dirty) {
      state.dirty = false;
      await save();
    }
    state.writing = null;
  })();
}

// The whole file, or none at all once every book is empty.
async function save(): Promise<void> {
  const file = statePath();
  try {
    if (state.books.size === 0) {
      await fs.rm(file, { force: true });
    } else {
      await writeFileAtomic(file, JSON.stringify({ version: FILE_VERSION, books: Object.fromEntries(state.books) }));
    }
    state.failed = false;
  } catch (e) {
    if (!state.failed) {
      log.warn(`can't save the alert state, so a restart may announce open warnings again: ${errorReason(e)}`);
    }
    state.failed = true;
  }
}

// For the tests: the write in flight, if any.
export function alertStateSaved(): Promise<void> {
  return state.writing ?? Promise.resolve();
}

// For the tests: start over, as a new process would.
export function resetAlertState(): void {
  state.books.clear();
  state.texts.clear();
  state.loaded = null;
  state.dirty = false;
  state.writing = null;
  state.failed = false;
}
