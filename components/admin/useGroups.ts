"use client";

import { useCallback, useState } from "react";
import type { AppItem, BookmarkItem, Group } from "@/lib/schema";
import { apiErrorMessage } from "./apiError";

// The groups apps and bookmarks belong to (#299), held once for the whole
// admin so every tab sees a group the moment another one creates or renames
// it (the tabs remount on every switch). An item save may create a group
// server-side, so a form calls `refresh` after naming a new one.
export function useGroups(initial: Group[]) {
  const [groups, setGroups] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/groups");
      if (res.ok) setGroups(await res.json());
    } catch {
      // The list catches up on the next save or reload.
    }
  }, []);

  // Replace the list (rename, reorder, merge, delete). Resolves with the
  // items a merge moved; throws with the API's message.
  const save = useCallback(
    async (next: Group[]): Promise<{ apps: AppItem[]; bookmarks: BookmarkItem[] }> => {
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
      return { apps: data.apps, bookmarks: data.bookmarks };
    },
    []
  );

  return { groups, setGroups, refresh, save };
}

export type GroupsState = ReturnType<typeof useGroups>;
