// Groups (#299): resolving the group an item form names, and the admin's
// rename/reorder/merge/delete of the list.
import type { AppItem, BookmarkItem, Config, Group } from "../schema";
import { findGroupByName } from "../groups";
import { slugId } from "../slug";
import { mutate, readConfigInternal } from "./store";

export async function listGroups(): Promise<Group[]> {
  return (await readConfigInternal()).groups;
}

// The id of the group `name` means, creating it at the end of the list when
// no group has that name yet. "" means no group.
export function resolveGroupName(config: Config, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const found = findGroupByName(config.groups, trimmed);
  if (found) return found.id;
  const id = slugId(trimmed, config.groups.map((g) => g.id), "group");
  config.groups.push({ id, name: trimmed });
  return id;
}

export class GroupInUseError extends Error {}

export type GroupsResult = { groups: Group[]; apps: AppItem[]; bookmarks: BookmarkItem[] };

// Replace the group list: new names and order. A group given the same name
// as one earlier in the list merges into it (its apps, bookmarks and widget
// filters move over). A group left out is deleted, which only an unused group
// can be: removing one that apps or bookmarks still belong to throws.
export async function replaceGroups(input: Group[]): Promise<GroupsResult> {
  return mutate((config) => {
    const merged = new Map<string, string>();
    const next: Group[] = [];
    for (const g of input) {
      const same = findGroupByName(next, g.name);
      if (same) merged.set(g.id, same.id);
      else
        next.push({
          id: g.id,
          name: g.name.trim(),
          ...(g.icon ? { icon: g.icon } : {}),
          ...(g.color ? { color: g.color } : {}),
        });
    }
    const moveTo = (id: string) => merged.get(id) ?? id;
    for (const a of config.apps) a.group = moveTo(a.group);
    for (const b of config.bookmarks) b.group = moveTo(b.group);
    for (const w of config.widgets) {
      if ((w.type === "apps" || w.type === "bookmarks") && w.filter.group) {
        w.filter.group = moveTo(w.filter.group);
      }
    }
    const kept = new Set(next.map((g) => g.id));
    const orphaned = [...config.apps, ...config.bookmarks].filter(
      (item) => item.group && !kept.has(item.group) && config.groups.some((g) => g.id === item.group)
    );
    if (orphaned.length > 0) {
      throw new GroupInUseError("A group that apps or bookmarks belong to can't be deleted");
    }
    config.groups = next;
    return { groups: config.groups, apps: config.apps, bookmarks: config.bookmarks };
  });
}
