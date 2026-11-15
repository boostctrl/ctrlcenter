// Groups of accounts (#505): the names a board, app or bookmark can be
// shared with in place of naming each account. The list is kept under
// auth.groups so a group can exist before anyone is in it; every group an
// account or a shared item names counts as well, so a file written before
// the list, or edited by hand, loses none. Renaming or removing a group
// rewrites every account and every audience that names it, in one write.
import { accountsOf } from "./accounts";
import type { Config } from "./schema";

type Shared = Pick<Config, "auth" | "boards" | "apps" | "bookmarks">;
type Audienced = { audience?: { users?: string[]; groups?: string[] } };

const sorted = (names: Iterable<string>) => [...new Set(names)].sort();

// Every item that can carry an audience, with the list it belongs to.
function sharedItems(c: Shared): { kind: "boards" | "apps" | "bookmarks"; item: Audienced }[] {
  return [
    ...c.boards.map((item) => ({ kind: "boards" as const, item })),
    ...c.apps.map((item) => ({ kind: "apps" as const, item })),
    ...c.bookmarks.map((item) => ({ kind: "bookmarks" as const, item })),
  ];
}

// Every group, sorted: the managed list, and any group an account or a
// shared item names.
export function accountGroups(c: Shared): string[] {
  const names = new Set(c.auth.groups);
  for (const u of accountsOf(c.auth)) for (const g of u.groups) names.add(g);
  for (const { item } of sharedItems(c)) for (const g of item.audience?.groups ?? []) names.add(g);
  return sorted(names);
}

// What a group holds, for the Users tab and the confirmation before a
// rename or a removal: its members, how many of each kind are shared with
// it, and how many with it alone, which become admins-only without it.
export type GroupUsage = {
  id: string;
  members: string[];
  boards: number;
  apps: number;
  bookmarks: number;
  only: number;
};

export function groupUsage(c: Shared): GroupUsage[] {
  const accounts = accountsOf(c.auth);
  const items = sharedItems(c);
  return accountGroups(c).map((id) => {
    const usage: GroupUsage = {
      id,
      members: accounts.filter((u) => u.groups.includes(id)).map((u) => u.id),
      boards: 0,
      apps: 0,
      bookmarks: 0,
      only: 0,
    };
    for (const { kind, item } of items) {
      const a = item.audience;
      if (!a?.groups?.includes(id)) continue;
      usage[kind]++;
      if (a.groups.length === 1 && !a.users?.length) usage.only++;
    }
    return usage;
  });
}

// Rewrite one group name everywhere it appears: `to` null removes it.
// Accounts keep their other groups in order; an audience left naming
// nobody is dropped, which is what admins-only is stored as.
function rewrite(c: Shared, from: string, to: string | null): void {
  const swap = (names: string[]) => [...new Set(names.flatMap((g) => (g === from ? (to ? [to] : []) : [g])))];

  c.auth.groups = sorted(swap(c.auth.groups));
  // Only a file with accounts listed is touched: the founding admin of a
  // file 3.0 wrote belongs to no group, and listing it here would be a
  // write for nothing.
  if (c.auth.users.some((u) => u.groups.includes(from))) {
    c.auth.users = c.auth.users.map((u) => (u.groups.includes(from) ? { ...u, groups: swap(u.groups) } : u));
  }
  for (const { item } of sharedItems(c)) {
    const a = item.audience;
    if (!a?.groups?.includes(from)) continue;
    const groups = sorted(swap(a.groups));
    const next = { ...(a.users?.length ? { users: a.users } : {}), ...(groups.length ? { groups } : {}) };
    if (next.users || next.groups) item.audience = next;
    else delete item.audience;
  }
}

// A group renamed: `to` takes its place on every account and in every
// audience. Renaming onto a group that exists merges the two.
export function renameGroup(c: Shared, from: string, to: string): void {
  if (from === to) return;
  rewrite(c, from, to);
  if (!c.auth.groups.includes(to)) c.auth.groups = sorted([...c.auth.groups, to]);
}

// A group removed from the list, every account and every audience.
export function removeGroup(c: Shared, id: string): void {
  rewrite(c, id, null);
}

// The managed list with these names added: an account given a group keeps
// it on the list, so the group outlives its last member until removed.
export function withGroups(list: readonly string[], names: readonly string[]): string[] {
  return names.every((g) => list.includes(g)) ? [...list] : sorted([...list, ...names]);
}
