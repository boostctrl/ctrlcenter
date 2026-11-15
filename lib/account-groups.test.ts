import { describe, expect, it } from "vitest";
import { accountGroups, groupUsage, removeGroup, renameGroup, withGroups } from "./account-groups";
import { authSchema } from "./schema/auth";

type Shared = Parameters<typeof accountGroups>[0];

// Accounts, a board and items shared with groups and accounts (#505).
function fixture(): Shared {
  return {
    auth: authSchema.parse({
      users: [
        { id: "admin", role: "admin" },
        { id: "sam", groups: ["family", "ops"] },
        { id: "kim", groups: ["family"] },
      ],
      groups: ["guests"],
    }),
    boards: [{ id: "home", audience: { groups: ["family"] } }],
    apps: [
      { id: "plex", audience: { groups: ["family", "ops"] } },
      { id: "nas", audience: { users: ["sam"], groups: ["ops"] } },
      { id: "wiki", audience: { groups: ["staff"] } },
      { id: "open" },
    ],
    bookmarks: [{ id: "recipes", audience: { groups: ["family"] } }],
  } as unknown as Shared;
}

describe("accountGroups (#505)", () => {
  it("lists the kept groups and every group an account or a shared item names, once each", () => {
    expect(accountGroups(fixture())).toEqual(["family", "guests", "ops", "staff"]);
  });

  it("counts a file from before the list, where only accounts name groups", () => {
    const c = fixture();
    c.auth.groups = [];
    expect(accountGroups(c)).toEqual(["family", "ops", "staff"]);
  });
});

describe("groupUsage", () => {
  it("names the members and counts what is shared with each group, and with it alone", () => {
    const usage = Object.fromEntries(groupUsage(fixture()).map((g) => [g.id, g]));
    expect(usage.family).toEqual({ id: "family", members: ["sam", "kim"], boards: 1, apps: 1, bookmarks: 1, only: 2 });
    // nas is shared with sam by name as well, so it isn't ops' alone.
    expect(usage.ops).toMatchObject({ members: ["sam"], apps: 2, only: 0 });
    expect(usage.guests).toMatchObject({ members: [], boards: 0, apps: 0, bookmarks: 0, only: 0 });
    expect(usage.staff).toMatchObject({ members: [], apps: 1, only: 1 });
  });
});

describe("renameGroup", () => {
  it("renames the group on every account, in every audience and in the list", () => {
    const c = fixture();
    renameGroup(c, "family", "household");
    expect(c.auth.users.map((u) => u.groups)).toEqual([[], ["household", "ops"], ["household"]]);
    expect(c.boards[0].audience).toEqual({ groups: ["household"] });
    expect(c.apps[0].audience).toEqual({ groups: ["household", "ops"] });
    expect(c.bookmarks[0].audience).toEqual({ groups: ["household"] });
    expect(c.auth.groups).toEqual(["guests", "household"]);
    expect(accountGroups(c)).not.toContain("family");
  });

  it("merges into a group that exists, naming it once", () => {
    const c = fixture();
    renameGroup(c, "ops", "family");
    expect(c.auth.users.find((u) => u.id === "sam")?.groups).toEqual(["family"]);
    expect(c.apps[0].audience).toEqual({ groups: ["family"] });
    expect(c.apps[1].audience).toEqual({ users: ["sam"], groups: ["family"] });
  });

  it("leaves a file without listed accounts as it is", () => {
    const c = { ...fixture(), auth: authSchema.parse({}) };
    renameGroup(c, "family", "household");
    expect(c.auth.users).toEqual([]);
  });
});

describe("removeGroup", () => {
  it("drops the group everywhere; an item shared with it alone becomes admins-only", () => {
    const c = fixture();
    removeGroup(c, "family");
    expect(c.auth.users.map((u) => u.groups)).toEqual([[], ["ops"], []]);
    expect(c.boards[0]).not.toHaveProperty("audience");
    expect(c.bookmarks[0]).not.toHaveProperty("audience");
    expect(c.apps[0].audience).toEqual({ groups: ["ops"] });
    expect(accountGroups(c)).toEqual(["guests", "ops", "staff"]);
  });

  it("keeps the accounts an audience names when its last group goes", () => {
    const c = fixture();
    removeGroup(c, "ops");
    expect(c.apps[1].audience).toEqual({ users: ["sam"] });
  });
});

describe("withGroups", () => {
  it("adds the names the list lacks, sorted", () => {
    expect(withGroups(["ops"], ["family", "ops"])).toEqual(["family", "ops"]);
    expect(withGroups(["ops"], [])).toEqual(["ops"]);
  });
});

describe("the stored list", () => {
  it("drops a name that isn't a group name, and repeats, so a hand edit can't fail the load", () => {
    expect(authSchema.parse({ groups: ["family", "Not A Slug", 3, "family"] }).groups).toEqual(["family"]);
    expect(authSchema.parse({ groups: "family" }).groups).toEqual([]);
  });
});
