"use client";

import { useState } from "react";
import type { AppItem, BookmarkItem, ThemePackConfig } from "@/lib/schema";

// The apps and bookmarks, held once for the whole admin like the groups
// (useGroups), so a change made in one tab is what every other tab shows
// (#317): Applications and Bookmarks edit them, and Settings reads them for
// the groups' usage counts, the apps filter's tags and the monitored apps.
export function useItems(initialApps: AppItem[], initialBookmarks: BookmarkItem[]) {
  const [apps, setApps] = useState(initialApps);
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  return { apps, setApps, bookmarks, setBookmarks };
}

export type ItemsState = ReturnType<typeof useItems>;

// The theme overrides, edited in Themes and read by Settings' theme pickers,
// keyed by the built-in's stable `key` (its original name) so the editable
// display `name` can differ.
export function useThemeOverrides(initial: ThemePackConfig[]) {
  const [overrides, setOverrides] = useState<Record<string, ThemePackConfig>>(() =>
    Object.fromEntries(
      initial.map((o) => {
        const key = o.key ?? o.name;
        return [key, { ...o, key }];
      })
    )
  );
  return { overrides, setOverrides };
}

export type ThemeOverridesState = ReturnType<typeof useThemeOverrides>;
