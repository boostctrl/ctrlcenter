// Barrel for the zod schemas, split per domain under lib/schema/. Everything
// importable from "@/lib/schema" before the split is re-exported here, so
// callers keep importing from this file. Conventions shared by the modules:
//
// "Stored" schemas (used to read config.yaml): every field has a default so
// a hand-edited or partially-filled YAML file still parses successfully.
//
// "Update" schemas (admin input): derived from the stored ones by
// lib/schema/input.ts (#287) — patchOf for sections the settings PUT
// deep-merges (every field optional, NO defaults: in Zod 4 a default inside
// an optional still fills in, which would blow away stored values on a
// partial update), wholeOf for list items that replace. Input-only rules
// (bounds, URL checks) are layered on per section. Layout and theme input
// stay hand-written: their input shape isn't the stored shape minus
// leniency (see lib/schema/layout.ts, theme.ts).
//
// Per-field rules that generic code reads — how a section merges, which
// fields are secret — are marked on the schemas via lib/schema/meta.ts.

export * from "./schema/theme";
export * from "./schema/search";
export * from "./schema/alerts";
export * from "./schema/webhooks";
export * from "./schema/widgets";
export * from "./schema/feeds";
export * from "./schema/integrations";
export * from "./schema/announcements";
export * from "./schema/layout";
export * from "./schema/apps-bookmarks";
export * from "./schema/auth";
export * from "./schema/settings";
export * from "./schema/config";
export * from "./schema/meta";
