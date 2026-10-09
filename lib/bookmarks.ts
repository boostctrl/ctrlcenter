import type { BookmarkItem } from "./schema";

// Order the bookmark categories that are actually present by the admin-set
// `order`, then append any present categories that aren't listed (in their given
// first-seen order). Stale entries in `order` (deleted/renamed categories) are
// ignored. Shared by the public dashboard and the admin manager.
export function orderCategories(present: string[], order: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of order) {
    if (!seen.has(c) && present.includes(c)) {
      result.push(c);
      seen.add(c);
    }
  }
  for (const c of present) {
    if (!seen.has(c)) {
      result.push(c);
      seen.add(c);
    }
  }
  return result;
}

// Bookmarks grouped by category, categories in display order (see
// orderCategories), each group keeping the list's own order.
export function groupBookmarks(
  bookmarks: BookmarkItem[],
  categoryOrder: string[]
): [string, BookmarkItem[]][] {
  const map = new Map<string, BookmarkItem[]>();
  for (const bookmark of bookmarks) {
    const list = map.get(bookmark.category) ?? [];
    list.push(bookmark);
    map.set(bookmark.category, list);
  }
  return orderCategories(Array.from(map.keys()), categoryOrder).map((c) => [
    c,
    map.get(c)!,
  ]);
}
