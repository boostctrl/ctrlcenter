// The one-time 2.x → 3.0 upgrade (#306). The store migrates a 2.x config on
// first read (or first write) and saves it in the 3.0 shape; around that
// rewrite this module:
// - keeps the 2.x file as config.v2.bak.yaml beside the config, never
//   overwritten (config.yaml.bak is also rewritten by every import, so it
//   can't be the rollback copy) — or under a dated name when an earlier
//   upgrade's copy already holds that one (see keepV2Backup);
// - logs one line saying what changed and which file to roll back to;
// - leaves a notice for the admin (upgrade-notice.json beside the config),
//   which the admin page shows as a banner until it's dismissed.
import fs from "fs/promises";
import path from "path";
import { configVersion } from "../config-migrate";
import { log } from "../log";
import { writeFileOnce } from "./files";

export const V2_BACKUP_NAME = "config.v2.bak.yaml";
const NOTICE_NAME = "upgrade-notice.json";

// Resolved lazily (not at module load) so tests can point CONFIG_PATH at a
// scratch directory. Untraced like CONFIG_PATH in lib/config/store.ts.
function configDir(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.dirname(configPath);
}

// What the upgrade did, in counts the banner and the log line can say.
export type UpgradeSummary = {
  // The schema the file had (1 = unstamped, ≤ 2.9) and has now.
  from: number;
  to: number;
  // Widget instances, boards, groups and integrations in the upgraded file.
  widgets: number;
  boards: number;
  groups: number;
  integrations: number;
  // The rollback copy's file name, beside the config: the one this upgrade
  // wrote or found holding the same file (#386).
  backup: string;
  // When it ran (ISO).
  at: string;
};

const count = (v: unknown, key: string): number => {
  const list = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list.length : 0;
};

export function summarizeUpgrade(
  before: unknown,
  after: unknown,
  backup = V2_BACKUP_NAME,
  at = new Date()
): UpgradeSummary {
  return {
    from: configVersion(before),
    to: configVersion(after),
    widgets: count(after, "widgets"),
    boards: count(after, "boards"),
    groups: count(after, "groups"),
    integrations: count(after, "integrations"),
    backup,
    at: at.toISOString(),
  };
}

// Keep `raw` as the rollback copy, without ever overwriting a file, and
// return the name it's kept under (#386). That's config.v2.bak.yaml unless
// the name already holds a different file: an earlier upgrade's copy (an rc
// tester who rolled back by restoring it, which leaves it in place, then ran
// 2.x for weeks), or one an interrupted first attempt left torn before this
// write was atomic. That file stays as it is, and this one is dated instead:
// config.v2.bak.<YYYY-MM-DD>.yaml (UTC, like the notice's `at`), then .2,
// .3, … that day. A name already holding exactly `raw` (an attempt that kept
// its backup but didn't finish the upgrade) is used as it is. Either way the
// name returned holds the file being upgraded, which is what a rollback needs.
async function keepV2Backup(dir: string, raw: string, now: Date): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const names = [V2_BACKUP_NAME, `config.v2.bak.${day}.yaml`];
  for (let n = 2; n < 100; n++) names.push(`config.v2.bak.${day}.${n}.yaml`);
  for (const name of names) {
    // turbopackIgnore: a runtime path, not a build input — without it the
    // build traces the whole project into the standalone output.
    const file = path.join(/* turbopackIgnore: true */ dir, name);
    if (await writeFileOnce(file, raw)) return name;
    if ((await fs.readFile(file, "utf8").catch(() => null)) === raw) return name;
  }
  throw new Error(`no free name left for the 2.x backup beside ${V2_BACKUP_NAME}`);
}

// Called by the store just before it saves a migrated config, with the file
// as it was (`raw`, parsed as `before`) and the migrated value. Does nothing
// unless this is the step out of 2.x, and not for an empty file (one created
// ahead of the first start): that's a new install, with nothing to back up.
// Failing to keep the backup stops the upgrade (better a 2.x file served in
// memory than one rewritten without its rollback copy); the notice is
// best-effort.
export async function recordUpgrade(raw: string, before: unknown, after: unknown): Promise<void> {
  if (configVersion(before) >= 3 || configVersion(after) < 3) return;
  if (typeof before === "object" && before !== null && Object.keys(before).length === 0) return;
  const dir = configDir();
  const now = new Date();
  const backup = await keepV2Backup(dir, raw, now);
  const summary = summarizeUpgrade(before, after, backup, now);
  log.info(
    `upgraded config.yaml to 3.0: ${summary.widgets} widgets, ${summary.boards} board(s), ` +
      `${summary.groups} groups, ${summary.integrations} integrations; the 2.x file is kept as ${backup}`
  );
  try {
    await fs.writeFile(path.join(dir, NOTICE_NAME), JSON.stringify(summary, null, 2), "utf8");
  } catch (e) {
    log.warn("couldn't save the upgrade notice", { reason: (e as Error).message });
  }
}

// The admin's upgrade banner: what the upgrade did, until dismissed.
export async function readUpgradeNotice(): Promise<UpgradeSummary | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(configDir(), NOTICE_NAME), "utf8"));
    return typeof parsed === "object" && parsed !== null && typeof parsed.to === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export async function dismissUpgradeNotice(): Promise<void> {
  await fs.rm(path.join(configDir(), NOTICE_NAME), { force: true });
}
