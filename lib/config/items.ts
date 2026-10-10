// Apps and bookmarks: create, update, delete, restore, reorder, and the bulk
// group/tag assignment (#290 split). Forms name a group by name; the stored
// item carries the group's id (#299), created on first use.
import type { AppItem, BookmarkItem, Group } from "../schema";
import { cleanTags } from "../schema";
import { newPushToken } from "../push";
import { mutate, readConfigInternal, NotFoundError } from "./store";
import { resolveGroupName } from "./groups";

// zod's .partial() can produce own keys with an explicit `undefined` value
// for omitted fields, which would otherwise clobber existing values when
// spread (and then get silently replaced by schema defaults on write).
function withoutUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export async function listApps(): Promise<AppItem[]> {
  return (await readConfigInternal()).apps;
}

// A push-checked app needs its secret URL token (#294); mint one the first
// time it's set to push, and keep it after (so a cron job's URL survives
// edits and switching away and back).
function withPushToken(app: AppItem): AppItem {
  return app.checkType === "push" && !app.pushToken ? { ...app, pushToken: newPushToken() } : app;
}

export type AppInput = Omit<AppItem, "id" | "pushToken" | "group"> & { groupName: string };

export async function createApp(input: AppInput): Promise<AppItem> {
  return mutate((config) => {
    const { groupName, ...rest } = input;
    const group = resolveGroupName(config, groupName);
    const item = withPushToken({ ...rest, group, id: crypto.randomUUID(), pushToken: "" });
    config.apps.push(item);
    return item;
  });
}

// The optional app fields an update can clear by sending null.
type Clearable = "port" | "interval" | "timeout" | "retries" | "certWarnDays";
export type AppUpdate = Partial<Omit<AppItem, "id" | "pushToken" | "group" | Clearable>> & {
  [K in Clearable]?: AppItem[K] | null;
} & { groupName?: string };

export async function updateApp(id: string, input: AppUpdate): Promise<AppItem> {
  return mutate((config) => {
    const idx = config.apps.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundError("App not found");
    const { groupName, ...rest } = input;
    const next: Record<string, unknown> = { ...config.apps[idx], ...withoutUndefined(rest) };
    if (groupName !== undefined) next.group = resolveGroupName(config, groupName);
    // null means "back to the default": drop the key.
    for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
    config.apps[idx] = withPushToken(next as AppItem);
    return config.apps[idx];
  });
}

export async function deleteApp(id: string): Promise<void> {
  await mutate((config) => {
    config.apps = config.apps.filter((a) => a.id !== id);
  });
}

// Re-inserts a deleted row at `index` (clamped), for undo (#307). Idempotent:
// if the id is already back (a double-clicked Undo), nothing changes.
function restoreAt<T extends { id: string }>(items: T[], item: T, index: number): T[] {
  if (items.some((existing) => existing.id === item.id)) return items;
  const at = Math.min(Math.max(0, index), items.length);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

export async function restoreApp(item: AppItem, index: number): Promise<AppItem[]> {
  return mutate((config) => {
    config.apps = restoreAt(config.apps, item, index);
    return config.apps;
  });
}

export async function restoreBookmark(
  item: BookmarkItem,
  index: number
): Promise<BookmarkItem[]> {
  return mutate((config) => {
    config.bookmarks = restoreAt(config.bookmarks, item, index);
    return config.bookmarks;
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

// Bulk-assign (#299): move the listed apps to a group ("" for none) and/or
// add tags to each. Unknown ids are skipped.
export async function bulkUpdateApps(input: {
  ids: string[];
  groupName?: string;
  addTags?: string[];
}): Promise<{ apps: AppItem[]; groups: Group[] }> {
  return mutate((config) => {
    const ids = new Set(input.ids);
    const group = input.groupName === undefined ? undefined : resolveGroupName(config, input.groupName);
    for (const app of config.apps) {
      if (!ids.has(app.id)) continue;
      if (group !== undefined) app.group = group;
      if (input.addTags?.length) app.tags = cleanTags([...app.tags, ...input.addTags]);
    }
    return { apps: config.apps, groups: config.groups };
  });
}

export async function listBookmarks(): Promise<BookmarkItem[]> {
  return (await readConfigInternal()).bookmarks;
}

export type BookmarkInput = Omit<BookmarkItem, "id" | "group"> & { groupName: string };

export async function createBookmark(input: BookmarkInput): Promise<BookmarkItem> {
  return mutate((config) => {
    const { groupName, ...rest } = input;
    const item: BookmarkItem = { ...rest, group: resolveGroupName(config, groupName), id: crypto.randomUUID() };
    config.bookmarks.push(item);
    return item;
  });
}

export async function updateBookmark(
  id: string,
  input: Partial<Omit<BookmarkInput, "groupName">> & { groupName?: string }
): Promise<BookmarkItem> {
  return mutate((config) => {
    const idx = config.bookmarks.findIndex((b) => b.id === id);
    if (idx === -1) throw new NotFoundError("Bookmark not found");
    const { groupName, ...rest } = input;
    config.bookmarks[idx] = {
      ...config.bookmarks[idx],
      ...withoutUndefined(rest),
      ...(groupName !== undefined ? { group: resolveGroupName(config, groupName) } : {}),
    };
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
