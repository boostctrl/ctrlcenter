import fs from "fs/promises";
import path from "path";
import YAML from "js-yaml";
import { GRID_COLUMNS } from "./layout";
import {
  configSchema,
  configReadSchema,
  type Config,
  type AppItem,
  type BookmarkItem,
  type Settings,
  type SettingsInput,
  type ThemePackConfig,
} from "./schema";

const CONFIG_PATH =
  process.env.CONFIG_PATH || path.join(process.cwd(), "config", "config.yaml");

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
// clobber each other's changes to the on-disk YAML file.
let writeQueue: Promise<unknown> = Promise.resolve();

async function ensureConfigExists(): Promise<void> {
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, YAML.dump(configSchema.parse({})), "utf8");
  }
}

// The raw, unfiltered config — private apps/bookmarks and the admin credential
// included. "Internal" is deliberate: anything rendering for a possibly
// signed-out visitor must go through readPublicConfig() (lib/api-auth.ts),
// which pre-filters private items, so a public surface can't reach the full
// list by accident. A test pins which files under app/ may import this.
export async function readConfigInternal(): Promise<Config> {
  await ensureConfigExists();
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = YAML.load(raw);
  // Lenient read: a single malformed row is dropped rather than 500-ing every
  // page on a hand-edited file (see configReadSchema). Writes/imports stay strict.
  return configReadSchema.parse(parsed ?? {});
}

// Dump a config as YAML to `dest` by writing a temp file then renaming into
// place (atomic on the same filesystem) so a concurrent reader can never observe
// a torn, half-written file and throw, and a crash mid-write can't leave a torn
// artifact. Mirrors the persistence in lib/status-history.ts. Used for both the
// live config and its .bak safety copy so they serialize identically.
async function dumpYaml(dest: string, config: Config): Promise<void> {
  const tmp = `${dest}.tmp`;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(tmp, YAML.dump(config, { lineWidth: 100 }), "utf8");
  await fs.rename(tmp, dest);
}

async function writeConfig(config: Config): Promise<void> {
  const validated = configSchema.parse(config);
  await dumpYaml(CONFIG_PATH, validated);
}

// Thrown by an item mutator when the target id/category isn't in the config, so
// a route can answer 404 for that case alone and not mislabel a genuine write
// failure (a full disk, a permissions problem, failed validation) the same way.
export class NotFoundError extends Error {}

async function mutate<T>(fn: (config: Config) => T): Promise<T> {
  const result = writeQueue.then(async () => {
    const config = await readConfigInternal();
    const out = fn(config);
    await writeConfig(config);
    return out;
  });
  // Keep the queue alive even if this mutation failed, but don't let one
  // rejection take down all subsequent operations.
  writeQueue = result.catch(() => undefined);
  return result;
}

// The config without the admin credential — what's safe to send over the API
// (export) and the surface an import is allowed to replace. The password lives
// outside this: it's set only through the ChangePassword flow, never carried in
// a backup file. See replaceConfig and the /api/config route.
export function stripAuth(config: Config): Omit<Config, "auth"> {
  const rest = { ...config };
  delete (rest as Partial<Config>).auth;
  return rest;
}

// Validate and write a whole config, replacing what's on disk (used by import).
// Goes through the same serialized write queue as mutate() so it can't race
// with concurrent edits.
export async function replaceConfig(input: unknown): Promise<Config> {
  const validated = configSchema.parse(input);
  const result = writeQueue.then(async () => {
    // Preserve the admin credential across an import. A backup file must not be
    // able to change or wipe the password: an older or hand-made config carries
    // no auth, which would otherwise silently drop this instance to passwordless
    // (falling back to ADMIN_PASSWORD), and a backup from another instance would
    // overwrite this one's password. Export omits auth for the same reason, so a
    // freshly exported file has none to apply anyway.
    const current = await readConfigInternal();
    // Snapshot the outgoing config to config.yaml.bak before overwriting it, so
    // a mistaken or bad import is recoverable. Runs inside the same write queue,
    // and is written atomically (tmp+rename) like the live file — this .bak is
    // the only artifact standing between a bad import and lost state, so a crash
    // mid-write must not leave it torn.
    await dumpYaml(CONFIG_BAK, current);
    validated.auth = current.auth;
    await writeConfig(validated);
    return validated;
  });
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function setPasswordHash(
  passwordHash: string,
  passwordSalt: string
): Promise<void> {
  await mutate((config) => {
    config.auth = { passwordHash, passwordSalt };
  });
}

export async function getSettings(): Promise<Settings> {
  return (await readConfigInternal()).settings;
}

// zod's .partial() can produce own keys with an explicit `undefined` value
// for omitted fields, which would otherwise clobber existing values when
// spread (and then get silently replaced by schema defaults on write).
function withoutUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export async function updateSettings(
  partial: SettingsInput
): Promise<Settings> {
  return mutate((config) => {
    const {
      weather: weatherPartial,
      search: searchPartial,
      alerts: alertsPartial,
      calendar: calendarPartial,
      notes: notesPartial,
      announcement: announcementPartial,
      feed: feedPartial,
      countdown: countdownPartial,
      components: componentsPartial,
      theme: themePartial,
      layout: layoutPartial,
      ...rest
    } = partial;
    config.settings = {
      ...config.settings,
      ...withoutUndefined(rest),
      weather: {
        ...config.settings.weather,
        ...withoutUndefined(weatherPartial ?? {}),
      },
      search: {
        ...config.settings.search,
        ...withoutUndefined(searchPartial ?? {}),
      },
      alerts: {
        ...config.settings.alerts,
        ...withoutUndefined(alertsPartial ?? {}),
      },
      calendar: {
        ...config.settings.calendar,
        ...withoutUndefined(calendarPartial ?? {}),
      },
      notes: {
        ...config.settings.notes,
        ...withoutUndefined(notesPartial ?? {}),
      },
      announcement: {
        ...config.settings.announcement,
        ...withoutUndefined(announcementPartial ?? {}),
      },
      feed: {
        ...config.settings.feed,
        ...withoutUndefined(feedPartial ?? {}),
      },
      countdown: {
        ...config.settings.countdown,
        ...withoutUndefined(countdownPartial ?? {}),
      },
      components: {
        ...config.settings.components,
        ...withoutUndefined(componentsPartial ?? {}),
      },
      // Theme is sent whole, so replace it (this is how clearing the optional
      // custom colors works); keep the existing one when not provided.
      theme: themePartial ?? config.settings.theme,
      // Layout is sent whole too (the ordered section list), so replace it.
      // Re-stamp the grid marker: writeConfig re-parses on save, and a stored
      // layout without `columns` would re-trigger the 12→24 span migration.
      layout: layoutPartial
        ? { ...layoutPartial, columns: GRID_COLUMNS }
        : config.settings.layout,
    };
    return config.settings;
  });
}

// Admin overrides of the built-in theme packs. Pair with resolveThemePacks()
// (lib/theme.ts) to get the packs visitors actually see.
export async function getThemeOverrides(): Promise<ThemePackConfig[]> {
  return (await readConfigInternal()).themes;
}

// Replace the whole overrides array (the admin Themes editor sends all edited
// packs at once; a reset omits that pack).
export async function setThemeOverrides(
  themes: ThemePackConfig[]
): Promise<ThemePackConfig[]> {
  return mutate((config) => {
    config.themes = themes;
    return config.themes;
  });
}

export async function listApps(): Promise<AppItem[]> {
  return (await readConfigInternal()).apps;
}

export async function createApp(input: Omit<AppItem, "id">): Promise<AppItem> {
  return mutate((config) => {
    const item: AppItem = { ...input, id: crypto.randomUUID() };
    config.apps.push(item);
    return item;
  });
}

export async function updateApp(
  id: string,
  input: Partial<Omit<AppItem, "id">>
): Promise<AppItem> {
  return mutate((config) => {
    const idx = config.apps.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundError("App not found");
    config.apps[idx] = { ...config.apps[idx], ...withoutUndefined(input) };
    return config.apps[idx];
  });
}

export async function deleteApp(id: string): Promise<void> {
  await mutate((config) => {
    config.apps = config.apps.filter((a) => a.id !== id);
  });
}

// Reorders `items` to match the order of `ids`. Ids not present in `items`
// are ignored; items whose id isn't listed are kept and appended in their
// existing order, so a stale or partial id list can never drop data.
function applyOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  for (const remaining of byId.values()) ordered.push(remaining);
  return ordered;
}

export async function reorderApps(ids: string[]): Promise<AppItem[]> {
  return mutate((config) => {
    config.apps = applyOrder(config.apps, ids);
    return config.apps;
  });
}

export async function listBookmarks(): Promise<BookmarkItem[]> {
  return (await readConfigInternal()).bookmarks;
}

export async function createBookmark(
  input: Omit<BookmarkItem, "id">
): Promise<BookmarkItem> {
  return mutate((config) => {
    const item: BookmarkItem = { ...input, id: crypto.randomUUID() };
    config.bookmarks.push(item);
    return item;
  });
}

export async function updateBookmark(
  id: string,
  input: Partial<Omit<BookmarkItem, "id">>
): Promise<BookmarkItem> {
  return mutate((config) => {
    const idx = config.bookmarks.findIndex((b) => b.id === id);
    if (idx === -1) throw new NotFoundError("Bookmark not found");
    config.bookmarks[idx] = { ...config.bookmarks[idx], ...withoutUndefined(input) };
    return config.bookmarks[idx];
  });
}

export async function deleteBookmark(id: string): Promise<void> {
  await mutate((config) => {
    config.bookmarks = config.bookmarks.filter((b) => b.id !== id);
  });
}

export async function reorderBookmarks(ids: string[]): Promise<BookmarkItem[]> {
  return mutate((config) => {
    config.bookmarks = applyOrder(config.bookmarks, ids);
    return config.bookmarks;
  });
}

// Rename a whole bookmark category in one atomic write: retag every bookmark
// with category `from` to `to`, and rewrite `bookmarkCategoryOrder` in place so
// the renamed group keeps its display position instead of falling back to
// first-seen order. Renaming onto a name that already exists (or is already in
// the order) merges the two — the duplicate is dropped from the order, keeping
// the earlier position. Throws when no bookmark carries `from` (the route maps
// that to a 404, mirroring updateBookmark).
export async function renameBookmarkCategory(
  from: string,
  to: string
): Promise<{ bookmarks: BookmarkItem[]; bookmarkCategoryOrder: string[] }> {
  return mutate((config) => {
    const matches = config.bookmarks.filter((b) => b.category === from);
    if (matches.length === 0) throw new NotFoundError("Category not found");
    for (const b of config.bookmarks) {
      if (b.category === from) b.category = to;
    }
    // Replace `from` with `to` in the display order, then de-duplicate so a
    // merge collapses to a single entry at the earlier of the two positions.
    const seen = new Set<string>();
    config.settings.bookmarkCategoryOrder =
      config.settings.bookmarkCategoryOrder.reduce<string[]>((acc, name) => {
        const renamed = name === from ? to : name;
        if (!seen.has(renamed)) {
          seen.add(renamed);
          acc.push(renamed);
        }
        return acc;
      }, []);
    return {
      bookmarks: config.bookmarks,
      bookmarkCategoryOrder: config.settings.bookmarkCategoryOrder,
    };
  });
}
