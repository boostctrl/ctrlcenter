// The one-time 2.x → 3.0 upgrade (#306). The store migrates a 2.x config on
// first read (or first write) and saves it in the 3.0 shape; around that
// rewrite this module:
// - keeps the 2.x file as config.v2.bak.yaml beside the config, written once
//   and never overwritten (config.yaml.bak is also rewritten by every import,
//   so it can't be the rollback copy);
// - logs one line saying what changed;
// - leaves a notice for the admin (upgrade-notice.json beside the config),
//   which the admin page shows as a banner until it's dismissed.
import fs from "fs/promises";
import path from "path";
import { configVersion } from "../config-migrate";
import { log } from "../log";

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
  // The rollback copy's file name, beside the config.
  backup: string;
  // When it ran (ISO).
  at: string;
};

const count = (v: unknown, key: string): number => {
  const list = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list.length : 0;
};

export function summarizeUpgrade(before: unknown, after: unknown, at = new Date()): UpgradeSummary {
  return {
    from: configVersion(before),
    to: configVersion(after),
    widgets: count(after, "widgets"),
    boards: count(after, "boards"),
    groups: count(after, "groups"),
    integrations: count(after, "integrations"),
    backup: V2_BACKUP_NAME,
    at: at.toISOString(),
  };
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
  try {
    // "wx": only if there isn't one — the first upgrade's copy is the one
    // worth keeping.
    await fs.writeFile(path.join(dir, V2_BACKUP_NAME), raw, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const summary = summarizeUpgrade(before, after);
  log.info(
    `upgraded config.yaml to 3.0: ${summary.widgets} widgets, ${summary.boards} board(s), ` +
      `${summary.groups} groups, ${summary.integrations} integrations; the 2.x file is kept as ${V2_BACKUP_NAME}`
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
