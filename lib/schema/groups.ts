// Groups (#299, 3.0): one ordered list of named groups that apps and
// bookmarks both belong to. A bookmark always has a group (it was a free-text
// category before 3.0); an app may. Apps widgets filter by group, bookmarks
// widgets show their groups in this order. Items store the group's id, so
// renaming a group touches nothing else.
import { z } from "zod";

export const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const groupId = z.string().min(1).max(64).regex(GROUP_ID_PATTERN);

export const MAX_GROUPS = 100;
export const MAX_GROUP_NAME = 60;

export const groupSchema = z.object({
  id: groupId,
  name: z.string().trim().min(1).max(MAX_GROUP_NAME),
});
export type Group = z.infer<typeof groupSchema>;

// Stored leniently: a group that won't parse is dropped, and a repeated id
// keeps its first entry.
export const groupsSchema = z
  .array(z.unknown())
  .catch([])
  .default([])
  .transform((rows): Group[] => {
    const seen = new Set<string>();
    const out: Group[] = [];
    for (const row of rows) {
      const parsed = groupSchema.safeParse(row);
      if (!parsed.success || seen.has(parsed.data.id)) continue;
      seen.add(parsed.data.id);
      out.push(parsed.data);
    }
    return out.slice(0, MAX_GROUPS);
  });

// Admin input (PUT /api/groups): the whole list, in order. Two groups given
// the same name merge into the first (lib/config/groups.ts).
export const groupsUpdateSchema = z
  .array(groupSchema)
  .max(MAX_GROUPS)
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    list.forEach((g, i) => {
      if (ids.has(g.id)) ctx.addIssue({ code: "custom", message: "Duplicate group id", path: [i, "id"] });
      ids.add(g.id);
    });
  });

// A group named in an item form: an existing group's name (any case), or a
// new one the server creates. Apps may send "" for none.
export const groupNameInput = z.string().trim().max(MAX_GROUP_NAME);

// An app's tags (#299): short free-text labels an apps widget can filter on.
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;
// Trimmed, empties dropped, repeats (any case) dropped, capped.
export function cleanTags(tags: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const tag = t.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}
export const tagsInput = z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS).transform(cleanTags);
