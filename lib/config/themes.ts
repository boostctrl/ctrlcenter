// The admin's theme gallery (#290 split, #334).
import type { ThemeEntryConfig } from "../schema";
import { mutate, readConfigInternal } from "./store";

// The gallery entries as stored. Pair with resolveThemePacks() (lib/theme.ts)
// to get the packs visitors actually see, or resolveThemeGallery() for all.
export async function getThemeOverrides(): Promise<ThemeEntryConfig[]> {
  return (await readConfigInternal()).themes;
}

// Replace the whole gallery (the admin Themes editor sends every entry at
// once; a reset entry carries no fields of its own).
export async function setThemeOverrides(
  themes: ThemeEntryConfig[]
): Promise<ThemeEntryConfig[]> {
  return mutate((config) => {
    config.themes = themes;
    return config.themes;
  });
}
