import type { z } from "zod";
import type { settingsInputSchema } from "@/lib/schema";
import { apiErrorMessage } from "./apiError";

// Save a partial settings update. /api/settings merges it key by key, so a
// caller sends only the sections it owns (the layout editor its layout, the
// bookmarks tab its category order) and never reverts anything saved from
// another surface. Throws with the API's error message, or `fallback` (also
// for a network failure, so callers never show a raw "Failed to fetch").
// `keepalive` lets a save fired from a page unload still complete.
export async function saveSettingsPatch(
  // The PUT body as the API parses it, so fields the schema defaults (the
  // layout's `columns`, say) may be left out.
  patch: z.input<typeof settingsInputSchema>,
  { fallback = "Failed to save settings", keepalive }: {
    fallback?: string;
    keepalive?: boolean;
  } = {}
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      keepalive,
    });
  } catch {
    throw new Error(fallback);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, fallback));
  }
}
