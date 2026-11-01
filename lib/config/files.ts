// How the files holding the config are written (#386): config.yaml, its .bak
// and the 2.x rollback copy all carry the password hash, the TOTP secret,
// integration keys, the SMTP password and webhook tokens.
// - Private: each is created 0600, like sessions.json and session-secret.
//   The umask's usual 0644 left them readable by every account on the host
//   through the bind mount, and since every save renames a fresh file into
//   place, an admin's `chmod 600 config.yaml` only lasted until the next one.
// - Durable: the data is fsynced before the file takes its final name, and
//   the directory after, so a crash can't leave the name on an empty or torn
//   file.
import fs, { type FileHandle } from "fs/promises";
import path from "path";
import { log, errorReason } from "../log";

const PRIVATE = 0o600;

// What fsync on a directory fails with where the platform or filesystem
// can't do it (Windows can't even open one). The file itself was synced.
const NO_DIR_SYNC = new Set(["EINVAL", "EPERM", "EISDIR", "ENOTSUP", "EOPNOTSUPP"]);

// What link(2) fails with on a filesystem without hard links (some FUSE and
// SMB mounts; Unraid's user shares with hard links turned off).
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? "";

// Create `file` ("wx": it mustn't exist) holding `text`, 0600 and synced. A
// failed write removes it rather than leave half a file under the name.
async function createSynced(file: string, text: string): Promise<void> {
  const handle = await fs.open(file, "wx", PRIVATE);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } catch (e) {
    await handle.close().catch(() => undefined);
    await fs.rm(file, { force: true }).catch(() => undefined);
    throw e;
  }
  await handle.close();
}

// Best effort: makes a rename or link that just happened in `dir` durable.
// Never throws: by now the file has its name, so failing the save would say
// it didn't land when it did; an unexpected error is logged instead.
async function syncDir(dir: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (e) {
    if (!NO_DIR_SYNC.has(code(e))) log.warn("config directory sync failed", { reason: errorReason(e) });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

// The temp file both writers start from, `<dest>.tmp`, created fresh. The
// fixed name means one a crash left behind is found and removed first:
// writing into it would keep its old mode (0644 before #386), or follow it if
// it's a symlink. Safe because every caller runs in the store's write queue,
// one at a time.
async function writeTemp(tmp: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  await fs.rm(tmp, { force: true });
  await createSynced(tmp, text);
}

// Replace `dest` with `text` via a temp file renamed into place (atomic on
// the same filesystem), so a concurrent reader never observes a torn file and
// a crash leaves either the old file or the new one.
export async function writeFileAtomic(dest: string, text: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  try {
    await writeTemp(tmp, text);
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  await syncDir(path.dirname(dest));
}

// Write `text` as `dest` only if nothing has that name yet; false if
// something does. The synced temp file is hard-linked to `dest` — link(2),
// unlike rename, fails with EEXIST instead of replacing a file — then removed,
// so `dest` appears whole or not at all: an interrupted attempt can't leave a
// torn copy for later starts to find.
export async function writeFileOnce(dest: string, text: string): Promise<boolean> {
  const tmp = `${dest}.tmp`;
  try {
    await writeTemp(tmp, text);
    try {
      await fs.link(tmp, dest);
    } catch (e) {
      if (!NO_HARD_LINKS.has(code(e))) throw e;
      // Without hard links, an exclusive create of `dest` itself: it still
      // never replaces a file, it just isn't all-or-nothing on a crash.
      await createSynced(dest, text);
    }
  } catch (e) {
    if (code(e) === "EEXIST") return false;
    throw e;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
  await syncDir(path.dirname(dest));
  return true;
}

// The files beside the config that hold secrets or private state. #386
// creates each of them 0600, but only a rewrite could fix one made before
// it, and some are never rewritten: an rc-era config.v2.bak.yaml stayed
// world-readable for good, password hash and TOTP secret included (#408).
// So every start tightens whichever of them is wider than 0600. Best effort:
// a file this process can't change, or a platform without POSIX modes, is
// left as it is. Returns the names it tightened.
const PRIVATE_NAMES = new Set([
  "sessions.json",
  "session-secret",
  "security-events.jsonl",
  "upgrade-notice.json",
]);
export async function tightenPrivateFiles(configPath: string): Promise<string[]> {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  const isPrivate = (name: string) =>
    name === base ||
    name === `${base}.bak` ||
    name.startsWith("config.v2.bak") ||
    PRIVATE_NAMES.has(name);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const tightened: string[] = [];
  for (const name of names.filter(isPrivate)) {
    const file = path.join(dir, name);
    try {
      const st = await fs.lstat(file);
      if (!st.isFile() || (st.mode & 0o077) === 0) continue;
      await fs.chmod(file, PRIVATE);
      tightened.push(name);
    } catch (e) {
      log.warn("couldn't make a config file private", { file: name, reason: errorReason(e) });
    }
  }
  if (tightened.length > 0) {
    log.info("made config files private (0600)", { files: tightened.join(", ") });
  }
  return tightened;
}
