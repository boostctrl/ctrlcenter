// Barrel for the zod schemas, split per domain under lib/schema/. Everything
// importable from "@/lib/schema" before the split is re-exported here, so
// callers keep importing from this file. Conventions shared by the modules:
//
// "Stored" schemas (used to read config.yaml): every field has a default so
// a hand-edited or partially-filled YAML file still parses successfully.
//
// "Update" schemas (PUT / partial merge): every field is plain-optional with
// NO `.default()`. This matters — chaining `.partial()` off a schema whose
// fields already carry `.default()` doesn't leave omitted fields untouched,
// it immediately substitutes their defaults, which would silently blow away
// existing values during a partial update. Keeping these schemas separate
// and default-free is what makes "only send the fields you're changing" work.

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
