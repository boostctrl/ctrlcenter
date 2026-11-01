import { describe, it, expect } from "vitest";
import { ADMIN_VIEW, canSee, inAudience, isMember, isPrivate, visibleTo, type Viewing } from "./visibility";

const sam: Viewing = { account: { id: "sam", groups: ["family"] }, isAdmin: false };
const kim: Viewing = { account: { id: "kim", groups: [] }, isAdmin: false };

describe("who can see what (#423)", () => {
  it("shows a public item to everyone and a private one to admins only, by default", () => {
    const pub = { private: false };
    const priv = { private: true };
    for (const v of [null, sam, kim, ADMIN_VIEW]) expect(canSee(pub, v)).toBe(true);
    expect(canSee(priv, null)).toBe(false);
    expect(canSee(priv, sam)).toBe(false);
    expect(canSee(priv, ADMIN_VIEW)).toBe(true);
  });

  it("shows a private item to the accounts and groups in its audience, never to a visitor", () => {
    const byUser = { private: true, audience: { users: ["sam"] } };
    const byGroup = { visibility: "private" as const, audience: { groups: ["family"] } };
    expect(canSee(byUser, sam)).toBe(true);
    expect(canSee(byUser, kim)).toBe(false);
    expect(canSee(byGroup, sam)).toBe(true);
    expect(canSee(byGroup, kim)).toBe(false);
    expect(canSee(byUser, null)).toBe(false);
    expect(canSee(byGroup, null)).toBe(false);
    // An empty audience names no one.
    expect(canSee({ private: true, audience: { users: [], groups: [] } }, sam)).toBe(false);
    expect(inAudience(undefined, sam)).toBe(false);
  });

  it("reads a board's visibility and an item's flag the same way", () => {
    expect(isPrivate({ visibility: "public" })).toBe(false);
    expect(isPrivate({ visibility: "private" })).toBe(true);
    expect(isPrivate({ private: true })).toBe(true);
    const boards = [
      { id: "home", visibility: "public" as const },
      { id: "family", visibility: "private" as const, audience: { groups: ["family"] } },
      { id: "ops", visibility: "private" as const },
    ];
    expect(visibleTo(boards, null).map((b) => b.id)).toEqual(["home"]);
    expect(visibleTo(boards, sam).map((b) => b.id)).toEqual(["home", "family"]);
    expect(visibleTo(boards, kim).map((b) => b.id)).toEqual(["home"]);
    expect(visibleTo(boards, ADMIN_VIEW).map((b) => b.id)).toEqual(["home", "family", "ops"]);
  });

  it("calls a signed-in non-admin a member", () => {
    expect(isMember(null)).toBe(false);
    expect(isMember(sam)).toBe(true);
    expect(isMember(ADMIN_VIEW)).toBe(false);
  });
});
