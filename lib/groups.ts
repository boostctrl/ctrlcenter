// Groups (#299): the pure helpers shared by the dashboard, the admin and the
// server. Items store a group's id; the `groups` list gives names and order.
import type { AppItem, BookmarkItem, Group, InstanceOf } from "./schema";

// The heading for bookmarks with no (or a since-removed) group.
export const UNGROUPED_LABEL = "Other";

// A group's display name: its name, else the id itself for one the list
// doesn't carry (a hand edit), else "Other" for none.
export function groupName(groups: readonly Group[], id: string): string {
  if (!id) return UNGROUPED_LABEL;
  return groups.find((g) => g.id === id)?.name ?? id;
}

// The existing group a typed name means: same name, any case, ignoring
// surrounding spaces.
export function findGroupByName(groups: readonly Group[], name: string): Group | undefined {
  const key = name.trim().toLowerCase();
  return key ? groups.find((g) => g.name.trim().toLowerCase() === key) : undefined;
}

// `icon` and `color` are the group's own (#316), absent when it has none.
export type BookmarkGroupView = { id: string; name: string; items: BookmarkItem[] } & Pick<Group, "icon" | "color">;

// Bookmarks under their groups: groups in list order, then any group id the
// list doesn't carry in first-seen order, each keeping the bookmarks' own
// order. Only groups with bookmarks appear.
export function groupBookmarks(
  bookmarks: readonly BookmarkItem[],
  groups: readonly Group[]
): BookmarkGroupView[] {
  const byGroup = new Map<string, BookmarkItem[]>();
  for (const b of bookmarks) {
    const list = byGroup.get(b.group) ?? [];
    list.push(b);
    byGroup.set(b.group, list);
  }
  const order = [...groups.map((g) => g.id), ...byGroup.keys()];
  const out: BookmarkGroupView[] = [];
  const done = new Set<string>();
  for (const id of order) {
    const items = byGroup.get(id);
    if (!items || done.has(id)) continue;
    done.add(id);
    const group = groups.find((g) => g.id === id);
    out.push({
      id,
      name: groupName(groups, id),
      items,
      ...(group?.icon ? { icon: group.icon } : {}),
      ...(group?.color ? { color: group.color } : {}),
    });
  }
  return out;
}

// Whether an apps widget's filter (#299) takes this app. Tags match in any
// case.
export function appMatches(app: AppItem, filter: InstanceOf<"apps">["filter"]): boolean {
  if (filter.group && app.group !== filter.group) return false;
  if (filter.tag) {
    const tag = filter.tag.toLowerCase();
    if (!app.tags.some((t) => t.toLowerCase() === tag)) return false;
  }
  if (filter.private === "hide" && app.private) return false;
  if (filter.private === "only" && !app.private) return false;
  return true;
}

// Every tag in use, in first-seen order (case-insensitive), for pickers.
export function allTags(apps: readonly Pick<AppItem, "tags">[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of apps)
    for (const t of a.tags) {
      if (seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
  return out;
}

// How many apps and bookmarks each group holds, by id.
export function groupUsage(
  apps: readonly Pick<AppItem, "group">[],
  bookmarks: readonly Pick<BookmarkItem, "group">[]
): Map<string, { apps: number; bookmarks: number }> {
  const out = new Map<string, { apps: number; bookmarks: number }>();
  const bump = (id: string, key: "apps" | "bookmarks") => {
    if (!id) return;
    const u = out.get(id) ?? { apps: 0, bookmarks: 0 };
    u[key]++;
    out.set(id, u);
  };
  for (const a of apps) bump(a.group, "apps");
  for (const b of bookmarks) bump(b.group, "bookmarks");
  return out;
}
