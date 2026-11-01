"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppItem, BookmarkItem, Group, WidgetInstance } from "@/lib/schema";
import { apiErrorMessage } from "./apiError";

// What a group save moved (#398): the apps, bookmarks and widgets as they
// now are, and which group ids merged into which.
export type GroupsMoved = {
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  widgets: WidgetInstance[];
  merged: Record<string, string>;
};

// The merges a Settings tab already open has to apply to its own widget
// draft (#398): a counter, so each save's map is applied once.
export type GroupMerges = { seq: number; map: Record<string, string> };

// The groups apps and bookmarks belong to (#299), held once for the whole
// admin so every tab sees a group the moment another one creates or renames
// it. An item save may create a group server-side, so a form calls
// `refresh` after naming a new one. `onSaved` hears every save, with what it
// moved, so the dashboard can bring the apps, bookmarks and widgets every
// tab holds into line, whichever tab saved (#398).
export function useGroups(initial: Group[], onSaved?: (moved: GroupsMoved) => void) {
  const [groups, setGroups] = useState(initial);
  // The latest callback, for the save closure below (a ref, so the save
  // callback itself stays stable).
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/groups");
      if (res.ok) setGroups(await res.json());
    } catch {
      // The list catches up on the next save or reload.
    }
  }, []);

  // Replace the list (rename, reorder, merge, delete). Resolves with what the
  // save moved; throws with the API's message.
  const save = useCallback(async (next: Group[]): Promise<GroupsMoved> => {
    let res: Response;
    try {
      res = await fetch("/api/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      throw new Error("Failed to save groups");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(apiErrorMessage(data, "Failed to save groups"));
    setGroups(data.groups);
    const moved: GroupsMoved = {
      apps: data.apps,
      bookmarks: data.bookmarks,
      widgets: data.widgets ?? [],
      merged: data.merged ?? {},
    };
    onSavedRef.current?.(moved);
    return moved;
  }, []);

  return { groups, setGroups, refresh, save };
}

export type GroupsState = ReturnType<typeof useGroups>;
