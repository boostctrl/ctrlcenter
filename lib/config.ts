import fs from "fs/promises";
import path from "path";
import YAML from "js-yaml";
import {
  configSchema,
  type Config,
  type AppItem,
  type BookmarkItem,
  type Settings,
  type SettingsInput,
} from "./schema";

const CONFIG_PATH =
  process.env.CONFIG_PATH || path.join(process.cwd(), "config", "config.yaml");

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

export async function readConfig(): Promise<Config> {
  await ensureConfigExists();
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = YAML.load(raw);
  return configSchema.parse(parsed ?? {});
}

async function writeConfig(config: Config): Promise<void> {
  const validated = configSchema.parse(config);
  await fs.writeFile(CONFIG_PATH, YAML.dump(validated, { lineWidth: 100 }), "utf8");
}

async function mutate<T>(fn: (config: Config) => T): Promise<T> {
  const result = writeQueue.then(async () => {
    const config = await readConfig();
    const out = fn(config);
    await writeConfig(config);
    return out;
  });
  // Keep the queue alive even if this mutation failed, but don't let one
  // rejection take down all subsequent operations.
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function getSettings(): Promise<Settings> {
  return (await readConfig()).settings;
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
    const { weather: weatherPartial, ...rest } = partial;
    config.settings = {
      ...config.settings,
      ...withoutUndefined(rest),
      weather: {
        ...config.settings.weather,
        ...withoutUndefined(weatherPartial ?? {}),
      },
    };
    return config.settings;
  });
}

export async function listApps(): Promise<AppItem[]> {
  return (await readConfig()).apps;
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
    if (idx === -1) throw new Error("App not found");
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
  return (await readConfig()).bookmarks;
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
    if (idx === -1) throw new Error("Bookmark not found");
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
