// Search bar settings: engine, custom URL template, and `!key` bangs.
import { z } from "zod";
import { SEARCH_ENGINE_KEYS, isValidCustomUrl } from "../search";

// Stored search config is lenient (so a hand-edited file always parses); the
// custom URL is validated on the admin-input path and at use time instead.
// A `!key` search shortcut → `%s` URL template. Stored leniently (validated on
// the admin path); malformed entries are simply ignored when resolving a query.
export const bangSchema = z.object({
  key: z.string().default(""),
  url: z.string().default(""),
});

export const searchSchema = z.object({
  engine: z.enum(SEARCH_ENGINE_KEYS).default("duckduckgo"),
  customUrl: z.string().default(""),
  bangs: z.array(bangSchema).default([]),
});

// Admin sends the full search object; reject a "custom" engine without a valid
// http(s) `%s` template so a broken search bar can't be saved.
export const searchUpdateSchema = z
  .object({
    engine: z.enum(SEARCH_ENGINE_KEYS),
    customUrl: z.string(),
    // Lenient on input so a half-typed bang row doesn't block autosave; bad rows
    // are ignored at resolve time.
    bangs: z.array(bangSchema).optional(),
  })
  .refine((s) => s.engine !== "custom" || isValidCustomUrl(s.customUrl), {
    message: "Custom search URL must start with http(s) and contain %s",
    path: ["customUrl"],
  });
