// The config file store (#290 split): where config.yaml lives, the cached
// read path (with the pre-2.0 shape migration applied on read and persisted
// once — the migrations themselves live in lib/config-migrate.ts), and the
// serialized write queue every mutation goes through. Per-domain CRUD lives
// beside this file and writes via mutate().
import fs from "fs/promises";
import path from "path";
import * as YAML from "js-yaml";
import { migrateConfig } from "../config-migrate";
import { updateYamlText } from "../config-yaml";
import { log, errorReason } from "../log";
import { globalSingleton } from "../singleton";
import { CONFIG_SCHEMA_VERSION, configSchema, configReadSchema, type Config } from "../schema";

// turbopackIgnore: a runtime path, not a build input. Without it Next's file
// tracing can't bound the fs reads below and copies the whole project — a dev
// checkout's config/ directory included — into the standalone output.
const CONFIG_PATH =
  process.env.CONFIG_PATH ||
  path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");

// Directory holding config.yaml and other runtime-written data (uploaded custom
// icons live in an `uploads/` subdir). Derived from CONFIG_PATH so everything
// persists in the same mounted volume.
export const CONFIG_DIR = path.dirname(CONFIG_PATH);

// Safety copy of the outgoing config, written just before an import replaces it
// (see replaceConfig). One file, overwritten each import, sitting beside the
// live config so a mistaken import is recoverable. Derived from CONFIG_PATH the
// same way CONFIG_DIR is, so it lands in the same mounted volume.
const CONFIG_BAK = `${CONFIG_PATH}.bak`;

// Serializes read-modify-write operations so concurrent admin requests can't
// clobber each other's changes to the on-disk YAML file. A process-wide
// singleton (lib/singleton.ts) so every route's module graph shares ONE queue —
// a plain module-level variable here would give each API route its own
// "serialization" and let writes from different endpoints interleave. The
// one-time shape migration's state rides along for the same reason: one
// attempt and one warn per process, not per route bundle.
type ConfigWrites = {
  queue: Promise<unknown>;
  migrationTask: Promise<void> | null;
  migrationFailed: boolean;
  // The last parsed read, keyed on the file's identity — see cachedRead.
  readCache?: { key: string; config: Config; changed: boolean } | null;
};
const writes = globalSingleton<ConfigWrites>("__ctrlcenterConfigWrites", () => ({
  queue: Promise.resolve(),
  migrationTask: null,
  migrationFailed: false,
}));

async function ensureConfigExists(): Promise<void> {
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, dump(configSchema.parse({})), "utf8");
  }
}

// Parse config.yaml text. Keeps js-yaml 4's tolerance, which 5 dropped: an
// empty or comment-only file reads as {} (all defaults) instead of throwing,
// and `<<: *anchor` merge keys in a hand-edited file still work. Unquoted
// dates now stay strings (js-yaml 5's core schema), which is what the config
// schema expects anyway. More than one document is still an error.
const YAML_SCHEMA = YAML.CORE_SCHEMA.withTags(YAML.mergeTag);

export function parseConfigYaml(raw: string): unknown {
  const docs = YAML.loadAll(raw, { schema: YAML_SCHEMA });
  if (docs.length > 1) {
    throw new Error("config.yaml must contain a single YAML document");
  }
  return docs[0] ?? {};
}

// Read + migrate + leniently parse the on-disk file. The pre-2.0 shape
// migration (lib/config-migrate.ts) is applied in memory on every read, so a
// legacy file serves correctly even before (or without) the one-time rewrite
// below; `changed` tells the caller whether the file itself still carries a
// legacy shape, and `raw` is the untouched on-disk text (for the .bak
// snapshot a queue-internal writer takes before it rewrites a legacy file).
async function loadMigrated(): Promise<{
  config: Config;
  changed: boolean;
  raw: string;
}> {
  await ensureConfigExists();
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const { value, changed } = migrateConfig(parseConfigYaml(raw));
  // Lenient read: a single malformed row is dropped rather than 500-ing every
  // page on a hand-edited file (see configReadSchema). Writes/imports stay strict.
  return { config: configReadSchema.parse(value), changed, raw };
}

// What the app loads from config text (the read path above, minus the file).
const readConfigText = (text: string): Config =>
  configReadSchema.parse(migrateConfig(parseConfigYaml(text)).value);

// loadMigrated for the read path, minus the repeat work: a page render reads
// the config several times (layout, page, proxy, each API call), and each read
// used to re-read, YAML-parse, migrate, and Zod-parse the file. The parsed
// result is cached against the file's inode, size, and mtime; every write
// renames a fresh file into place (new inode) and a hand edit bumps the mtime,
// so either invalidates it. Callers get their own structuredClone, so one can't
// mutate what the next one sees. Queue-internal writers keep calling
// loadMigrated directly — they must see the file as it is right now.
async function cachedRead(): Promise<{ config: Config; changed: boolean }> {
  await ensureConfigExists();
  const st = await fs.stat(CONFIG_PATH);
  const key = `${st.ino}:${st.size}:${st.mtimeMs}`;
  const hit = writes.readCache;
  if (hit && hit.key === key) {
    return { config: structuredClone(hit.config), changed: hit.changed };
  }
  const { config, changed } = await loadMigrated();
  // Stat-then-read can race a write: then this entry holds newer content under
  // the older key, and the next read's stat simply misses and reloads.
  writes.readCache = { key, config: structuredClone(config), changed };
  return { config, changed };
}

// The raw, unfiltered config — private apps/bookmarks and the admin credential
// included. "Internal" is deliberate: anything rendering for a possibly
// signed-out visitor must go through readPublicConfig() (lib/api-auth.ts),
// which pre-filters private items, so a public surface can't reach the full
// list by accident. A test pins which files under app/ may import this.
//
// The first read of a pre-2.0 file also rewrites it to the current shape
// (through the write queue, after snapshotting the original to config.yaml.bak).
// Queue-internal writers (mutate, replaceConfig) read via loadMigrated directly
// — awaiting a queued rewrite from inside the queue would deadlock — and take
// the same .bak snapshot themselves before their own write normalizes the file.
export async function readConfigInternal(): Promise<Config> {
  const { config, changed } = await cachedRead();
  if (changed) await persistShapeMigration();
  return config;
}

// Rewrite a pre-2.0 config file to the current shape, once. Deliberately does
// NOT launder the file through the schemas: only the legacy keys are rewritten,
// so unknown fields and rows the lenient read drops survive on disk — an
// unprompted background rewrite must never destroy data an admin didn't ask to
// change. The original file is snapshotted verbatim to config.yaml.bak first,
// same recovery contract as an import (#129).
//
// Runs once per process: while an attempt is in flight, concurrent reads share
// it instead of enqueueing their own (a first page load fans out several reads
// at once), and once the rewrite fails (say, a read-only volume) it isn't
// re-attempted until the next process start — reads keep working off the
// in-memory folds either way.
function persistShapeMigration(): Promise<void> {
  if (writes.migrationFailed) return Promise.resolve();
  if (!writes.migrationTask) {
    const task = writes.queue.then(async () => {
      // Re-read inside the queue: a write that landed since detection has
      // already normalized the file, making this a no-op.
      const raw = await fs.readFile(CONFIG_PATH, "utf8");
      const { value, changed } = migrateConfig(parseConfigYaml(raw));
      if (!changed) return;
      await writeFileAtomic(CONFIG_BAK, raw);
      await writeFileAtomic(
        CONFIG_PATH,
        updateYamlText(raw, value, parseConfigYaml, parseConfigYaml(raw)) ?? dump(value)
      );
      log.info("migrated config.yaml to the 2.0 shape", {
        backup: CONFIG_BAK,
      });
    });
    writes.queue = task.catch(() => undefined);
    writes.migrationTask = task.then(
      () => {
        // Success: clear the memo so a legacy shape hand-edited in later can
        // still trigger a fresh rewrite (a stray re-trigger is a no-op).
        writes.migrationTask = null;
      },
      (e) => {
        writes.migrationFailed = true;
        log.warn("config shape migration failed; serving the legacy file as-is", {
          reason: errorReason(e),
        });
      }
    );
  }
  return writes.migrationTask;
}

// Write `text` to `dest` via a temp file renamed into place (atomic on the same
// filesystem), so a concurrent reader can never observe a torn, half-written
// file and a crash mid-write can't leave a torn artifact. Mirrors the
// persistence in lib/status-history/store.ts.
async function writeFileAtomic(dest: string, text: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, dest);
}

function dump(value: unknown): string {
  return YAML.dump(value, { lineWidth: 100 });
}

// Write a config. Given the file it replaces (`previous`: its text and what
// it read as before the edit), the change is applied onto that file so its
// comments, key order and formatting survive, and keys it leaves to their
// defaults stay out (#279; lib/config-yaml.ts). Without one — an import,
// whose replaced config shouldn't inherit the old file's comments — or when
// that can't be done safely, a plain dump.
async function writeConfig(
  config: Config,
  previous?: { raw: string; config: Config }
): Promise<void> {
  // Whatever version the file was read at, it's written in this build's shape.
  const validated = configSchema.parse({
    ...config,
    schemaVersion: CONFIG_SCHEMA_VERSION,
  });
  let text: string | null = null;
  if (previous) {
    // Always (re)stamp the version, even into a file that left it implicit.
    const before: Partial<Config> = { ...previous.config };
    delete before.schemaVersion;
    text = updateYamlText(previous.raw, validated, readConfigText, before);
  }
  await writeFileAtomic(CONFIG_PATH, text ?? dump(validated));
}

// Thrown by an item mutator when the target id/category isn't in the config, so
// a route can answer 404 for that case alone and not mislabel a genuine write
// failure (a full disk, a permissions problem, failed validation) the same way.
// When config.yaml last changed (epoch ms): every write renames a fresh file
// into place, and a hand edit bumps it too. The status feed dates undated
// announcements by it (#295).
export async function configMtime(): Promise<number> {
  await ensureConfigExists();
  return (await fs.stat(CONFIG_PATH)).mtimeMs;
}

export class NotFoundError extends Error {}

export async function mutate<T>(fn: (config: Config) => T): Promise<T> {
  const result = writes.queue.then(async () => {
    const { config, changed, raw } = await loadMigrated();
    // writeConfig below rewrites the file in the current shape, so if the
    // on-disk file is still a pre-2.0 shape this mutation IS the one-time
    // migration — snapshot the untouched original to config.yaml.bak first,
    // the same recovery contract the read-path migration and imports uphold.
    // A mutation can be the first operation on a legacy file (a direct API
    // write before any page read triggered persistShapeMigration), so the
    // backup can't be left only to the read path.
    if (changed) await writeFileAtomic(CONFIG_BAK, raw);
    const before = structuredClone(config);
    const out = fn(config);
    await writeConfig(config, { raw, config: before });
    return out;
  });
  // Keep the queue alive even if this mutation failed, but don't let one
  // rejection take down all subsequent operations.
  writes.queue = result.catch(() => undefined);
  return result;
}

// Validate and write a whole config, replacing what's on disk (used by import).
// Goes through the same serialized write queue as mutate() so it can't race
// with concurrent edits. The shape migration runs on the input first, so a
// backup exported before 2.0.0 imports cleanly.
export async function replaceConfig(input: unknown): Promise<Config> {
  const validated = configSchema.parse(migrateConfig(input).value);
  const result = writes.queue.then(async () => {
    // Preserve the admin credential across an import. A backup file must not be
    // able to change or wipe the password: an older or hand-made config carries
    // no auth, which would otherwise silently drop this instance to passwordless
    // (falling back to ADMIN_PASSWORD), and a backup from another instance would
    // overwrite this one's password. Export omits auth for the same reason, so a
    // freshly exported file has none to apply anyway.
    const { config: current, raw } = await loadMigrated();
    // Snapshot the outgoing config to config.yaml.bak before overwriting it, so
    // a mistaken or bad import is recoverable. Save the untouched on-disk BYTES
    // (not the parsed config, which would strip any unknown/hand-added keys and
    // lose them from the only recovery artifact). Runs inside the same write
    // queue, written atomically (tmp+rename) like the live file — this .bak is
    // the only thing standing between a bad import and lost state, so a crash
    // mid-write must not leave it torn.
    await writeFileAtomic(CONFIG_BAK, raw);
    validated.auth = current.auth;
    await writeConfig(validated);
    return validated;
  });
  writes.queue = result.catch(() => undefined);
  return result;
}
