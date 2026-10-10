"use client";

import { useState } from "react";
import type { AppItem, BookmarkItem, ThemeEntryConfig } from "@/lib/schema";

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

// The theme gallery (#334), edited in Themes and read by Settings' theme
// pickers: the stored entries in order (see resolveThemeGallery for how they
// become packs).
export function useThemeGallery(initial: ThemeEntryConfig[]) {
  const [entries, setEntries] = useState<ThemeEntryConfig[]>(initial);
  return { entries, setEntries };
}

export type ThemeGalleryState = ReturnType<typeof useThemeGallery>;
