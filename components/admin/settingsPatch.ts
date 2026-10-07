import type { Settings } from "@/lib/schema";

// The top-level settings keys whose value differs between what the server was
// last told and the form's current state, as a partial update. The settings
// form autosaves through this instead of PUTting the whole object, because a
// whole-object save from an open admin tab would silently revert anything
// saved elsewhere since it loaded — a layout arranged in the home-page editor,
// a theme promoted from the theme builder, a bookmark category reordered.
// /api/settings merges partial updates key by key, so untouched keys stay as
// the server has them.
export function settingsPatch(prev: Settings, next: Settings): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      patch[key] = next[key];
    }
  }
  return patch as Partial<Settings>;
}
