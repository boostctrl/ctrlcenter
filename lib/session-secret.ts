import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { log, errorReason } from "./log";
import { globalSingleton } from "./singleton";

// The session-signing secret when SESSION_SECRET isn't set: 32 random bytes
// generated on first use and kept beside config.yaml in the mounted volume, so
// it survives restarts and upgrades. Before this, an unset SESSION_SECRET meant
// signing with a key derived from ADMIN_PASSWORD — a human-chosen value, which
// made one captured session cookie enough to brute-force the admin password
// offline.
//
// Returns null when the volume can't hold the file (read-only mount, odd
// permissions); auth.ts then falls back to the old ADMIN_PASSWORD derivation
// rather than locking the admin out.

const FILE_NAME = "session-secret";

// Per secret-file path; a process-wide singleton so every route bundle shares
// one load (and one first-run create).
const cache = globalSingleton(
  "__ctrlcenterSessionSecret",
  () => new Map<string, Promise<string | null>>()
);

// Resolved lazily (not at module load) so tests can point CONFIG_PATH at a
// scratch directory. Untraced like CONFIG_PATH in lib/config.ts.
function secretPath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), FILE_NAME);
}

async function loadOrCreate(file: string): Promise<string | null> {
  try {
    const existing = (await fs.readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`session secret unreadable, using ADMIN_PASSWORD: ${errorReason(e)}`);
      return null;
    }
  }
  const fresh = randomBytes(32).toString("base64url");
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // "wx": exclusive create, so two first requests racing each other can't
    // both write — the loser re-reads the winner's secret below.
    await fs.writeFile(file, fresh + "\n", { mode: 0o600, flag: "wx" });
    return fresh;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return (await fs.readFile(file, "utf8")).trim() || null;
    }
    log.warn(`can't persist a session secret, using ADMIN_PASSWORD: ${errorReason(e)}`);
    return null;
  }
}

export function persistedSessionSecret(): Promise<string | null> {
  const file = secretPath();
  let pending = cache.get(file);
  if (!pending) {
    pending = loadOrCreate(file);
    cache.set(file, pending);
  }
  return pending;
}
