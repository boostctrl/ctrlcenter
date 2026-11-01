// Who can see what (#423): one rule for boards (`visibility`), apps and
// bookmarks (`private`), with the audience a private item names.
import { type Audience } from "./schema/audience";

// A viewer as the rule needs one: the account and whether it is an admin.
// lib/api-auth's Viewer satisfies it; null is a signed-out visitor.
export type Viewing = { account: { id: string; groups: readonly string[] }; isAdmin: boolean };

// An item the rule applies to: a board, or an app or bookmark.
export type Visible = { audience?: Audience } & ({ visibility: "public" | "private" } | { private: boolean });

export function isPrivate(item: Visible): boolean {
  return "visibility" in item ? item.visibility === "private" : item.private;
}

// Whether the viewer is named by the audience, by account or by group.
export function inAudience(audience: Audience | undefined, viewer: Viewing): boolean {
  if (!audience) return false;
  if (audience.users?.includes(viewer.account.id)) return true;
  return audience.groups?.some((g) => viewer.account.groups.includes(g)) ?? false;
}

// A public item is for everyone; a private one for admins and the audience
// it names, never for a signed-out visitor.
export function canSee(item: Visible, viewer: Viewing | null): boolean {
  if (!isPrivate(item)) return true;
  if (!viewer) return false;
  return viewer.isAdmin || inAudience(item.audience, viewer);
}

// The viewer an admin-only surface can assume (the admin portal's pages,
// which requireAdminPage already gated): the rules read only `isAdmin` for
// one, so the account named here never matters.
export const ADMIN_VIEW: Viewing = { account: { id: "admin", groups: [] }, isAdmin: true };

export function visibleTo<T extends Visible>(items: readonly T[], viewer: Viewing | null): T[] {
  return items.filter((item) => canSee(item, viewer));
}

// Whether a signed-in viewer is a member rather than an admin: the one who
// needs a Sign out of their own, having no admin portal to do it from.
export function isMember(viewer: Viewing | null): boolean {
  return viewer !== null && !viewer.isAdmin;
}
