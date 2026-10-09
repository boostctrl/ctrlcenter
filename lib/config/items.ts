// Apps and bookmarks: create, update, delete, restore, reorder, and the
// bookmark category rename (#290 split).
import type { AppItem, BookmarkItem } from "../schema";
import { newPushToken } from "../push";
import { mutate, readConfigInternal, NotFoundError } from "./store";

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

export async function createApp(
  input: Omit<AppItem, "id" | "pushToken">
): Promise<AppItem> {
  return mutate((config) => {
    const item = withPushToken({ ...input, id: crypto.randomUUID(), pushToken: "" });
    config.apps.push(item);
    return item;
  });
}

// The optional app fields an update can clear by sending null.
type Clearable = "port" | "interval" | "timeout" | "retries" | "certWarnDays";
export type AppUpdate = Partial<Omit<AppItem, "id" | "pushToken" | Clearable>> & {
  [K in Clearable]?: AppItem[K] | null;
};

export async function updateApp(id: string, input: AppUpdate): Promise<AppItem> {
  return mutate((config) => {
    const idx = config.apps.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundError("App not found");
    const next: Record<string, unknown> = { ...config.apps[idx], ...withoutUndefined(input) };
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
