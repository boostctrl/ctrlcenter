// Who else may see a private board, app or bookmark (#423): the accounts
// and the groups named. An admin sees everything; a signed-out visitor never
// sees a private item; a member sees it when their account or one of their
// groups is named here. Absent, or empty, means admins only, which is what
// every private item from before accounts means.
import { z } from "zod";
import { USER_ID_PATTERN } from "./auth";

export const MAX_AUDIENCE = 64;

const slugList = z.array(z.string().regex(USER_ID_PATTERN, "Not a sign-in or group name")).max(MAX_AUDIENCE);

// What the admin's forms send: both lists optional, each a list of names.
export const audienceInputSchema = z.object({
  users: slugList.optional(),
  groups: slugList.optional(),
});
export type Audience = z.infer<typeof audienceInputSchema>;

// Stored: a hand-edited list that isn't one reads as none, and a name that
// isn't a slug is dropped from its list, so a typo in config.yaml can't fail
// the load or widen who sees the item.
const storedList = z
  .array(z.unknown())
  .catch([])
  .transform((a) =>
    a.filter((s): s is string => typeof s === "string" && USER_ID_PATTERN.test(s)).slice(0, MAX_AUDIENCE)
  );
export const audienceSchema = z.object({
  users: storedList.optional(),
  groups: storedList.optional(),
});

// Whether an audience names anyone at all.
export function audienceEmpty(audience: Audience | undefined): boolean {
  return !audience || (!audience.users?.length && !audience.groups?.length);
}
