// Admin overrides of the built-in theme packs (#290 split).
import type { ThemePackConfig } from "../schema";
import { mutate, readConfigInternal } from "./store";

// Admin overrides of the built-in theme packs. Pair with resolveThemePacks()
// (lib/theme.ts) to get the packs visitors actually see.
export async function getThemeOverrides(): Promise<ThemePackConfig[]> {
  return (await readConfigInternal()).themes;
}

// Replace the whole overrides array (the admin Themes editor sends all edited
// packs at once; a reset omits that pack).
export async function setThemeOverrides(
  themes: ThemePackConfig[]
): Promise<ThemePackConfig[]> {
  return mutate((config) => {
    config.themes = themes;
    return config.themes;
  });
}
