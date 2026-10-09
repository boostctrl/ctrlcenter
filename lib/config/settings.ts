// Settings reads and the settings PUT (#290 split).
import type { z } from "zod";
import { GRID_COLUMNS } from "../layout";
import {
  settingsSchema,
  mergeRules,
  type Settings,
  type SettingsInput,
  type WidgetInstance,
} from "../schema";
import { mutate, readConfigInternal } from "./store";

export async function getSettings(): Promise<Settings> {
  return (await readConfigInternal()).settings;
}

// The settings plus the widget instances, for server-rendered pages that
// derive navigation from both (the calendar link follows the calendar
// widgets, #297). Server-only: calendar credentials ride along.
export async function getSiteConfig(): Promise<{ settings: Settings; widgets: WidgetInstance[] }> {
  const { settings, widgets } = await readConfigInternal();
  return { settings, widgets };
}

// Server-only accessor for the calendar Basic-auth credentials. readPublicConfig
// redacts these (stripSecrets), so the home page — a public surface that fetches
// a private CalDAV/ICS feed server-side — reads them here instead of from the
// config it hands to client components, keeping them off any client-serializable
// object (#157). The CTRLCENTER_CALDAV_PASS env override is applied downstream in
// lib/calendar-fetch; this returns the stored values as-is.
// Per calendar widget (#297); empty credentials for an id that isn't one.
export async function getCalendarAuth(instanceId: string): Promise<{
  username: string;
  password: string;
}> {
  const w = (await readConfigInternal()).widgets.find((i) => i.id === instanceId);
  return w?.type === "calendar"
    ? { username: w.username, password: w.password }
    : { username: "", password: "" };
}

export async function updateSettings(
  partial: SettingsInput
): Promise<Settings> {
  return mutate((config) => {
    config.settings = mergeSettings(config.settings, partial);
    // Re-stamp the grid marker: writeConfig re-parses on save, and a stored
    // layout without `columns` would re-trigger the 12→24 span migration.
    if (partial.layout) {
      config.settings.layout = { ...config.settings.layout, columns: GRID_COLUMNS };
    }
    return config.settings;
  });
}

// Apply a settings PUT (#287): each section sent is deep-merged into the
// stored one — plain objects key by key, arrays and scalars replaced,
// undefined ignored — so only what the admin changed moves. Lists the admin
// sends whole (feed cards, announcements, layout sections) replace, which is
// how removing an entry persists. A section the schema marks
// merge: "replace" (lib/schema/meta.ts) is swapped whole instead.
function mergeSettings(current: Settings, patch: SettingsInput): Settings {
  const next: Record<string, unknown> = { ...current };
  const shape = settingsSchema.shape as Record<string, z.ZodType>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const field = shape[key];
    next[key] =
      field && mergeRules.get(field)?.merge === "replace" ? value : deepMerge(next[key], value);
  }
  return next as Settings;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = deepMerge(base[k], v);
  }
  return out;
}
