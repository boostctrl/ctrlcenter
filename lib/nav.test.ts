import { describe, it, expect } from "vitest";
import { activeCalendars, navBoards, navPages, pickBoard, visibleBoards } from "./nav";
import { boardsSchema, newInstance, settingsSchema } from "./schema";
import { ADMIN_VIEW } from "./visibility";

// Boards in the navigation, and who can open which (#298).
const boards = boardsSchema.parse([
  { id: "home", name: "Home", layout: { sections: [{ widget: "cal-public" }] } },
  { id: "infra", name: "Infra", visibility: "private", layout: { sections: [{ widget: "cal-private" }] } },
  { id: "media", icon: "jellyfin", layout: { sections: [{ widget: "cal-hidden", hidden: true }] } },
]);
const cal = (id: string) => ({ ...newInstance("calendar", id), url: `https://cal.test/${id}.ics` });
const widgets = [cal("cal-public"), cal("cal-private"), cal("cal-hidden"), { ...newInstance("calendar", "cal-nourl") }];
const site = { settings: settingsSchema.parse({}), boards, widgets };

describe("visibleBoards / navBoards", () => {
  it("lists every board for the admin, the public ones for everyone else", () => {
    expect(visibleBoards(boards, ADMIN_VIEW).map((b) => b.id)).toEqual(["home", "infra", "media"]);
    expect(visibleBoards(boards, null).map((b) => b.id)).toEqual(["home", "media"]);
  });

  it("links the visitor's first board to / and names a nameless one by id, with its icon (#316)", () => {
    expect(navBoards(boards, null)).toEqual([
      { id: "home", name: "Home", href: "/", icon: "" },
      { id: "media", name: "media", href: "/b/media", icon: "jellyfin" },
    ]);
  });

  it("makes the first public board a guest's home when the first board is private", () => {
    const privateFirst = boardsSchema.parse([{ id: "mine", visibility: "private" }, { id: "family" }]);
    expect(navBoards(privateFirst, null)).toEqual([{ id: "family", name: "family", href: "/", icon: "" }]);
    expect(navBoards(privateFirst, ADMIN_VIEW).map((b) => b.href)).toEqual(["/", "/b/family"]);
  });
});

describe("pickBoard", () => {
  it("shows the visitor's home board at /", () => {
    expect(pickBoard(boards, null, null)).toEqual({ kind: "board", board: boards[0] });
  });

  it("answers a private board like a missing one for a guest", () => {
    expect(pickBoard(boards, "infra", null)).toEqual({ kind: "notFound" });
    expect(pickBoard(boards, "nope", null)).toEqual({ kind: "notFound" });
    expect(pickBoard(boards, "infra", ADMIN_VIEW)).toEqual({ kind: "board", board: boards[1] });
  });

  it("sends /b/<home> to /", () => {
    expect(pickBoard(boards, "home", ADMIN_VIEW)).toEqual({ kind: "home" });
  });

  it("sends a visitor who can open no board to sign in", () => {
    const allPrivate = boardsSchema.parse([{ id: "home", visibility: "private" }]);
    expect(pickBoard(allPrivate, null, null)).toEqual({ kind: "signIn" });
    expect(pickBoard(allPrivate, null, ADMIN_VIEW)).toEqual({ kind: "board", board: allPrivate[0] });
  });
});

describe("activeCalendars", () => {
  it("counts a calendar shown on a board the visitor can open, with a URL", () => {
    expect(activeCalendars(site, null).map((c) => c.id)).toEqual(["cal-public"]);
    expect(activeCalendars(site, ADMIN_VIEW).map((c) => c.id)).toEqual(["cal-public", "cal-private"]);
  });

  it("drives the calendar link per visitor", () => {
    const onlyPrivate = { ...site, boards: boardsSchema.parse([{ id: "home" }, boards[1]]) };
    expect(navPages(onlyPrivate, null).calendar).toBe(false);
    expect(navPages(onlyPrivate, ADMIN_VIEW).calendar).toBe(true);
  });
});

describe("boards for a member (#423)", () => {
  const sam = { account: { id: "sam", groups: ["family"] }, isAdmin: false };
  const boards = [
    { id: "ops", name: "Ops", visibility: "private" as const, layout: { sections: [] } },
    { id: "family", name: "Family", visibility: "private" as const, audience: { groups: ["family"] }, layout: { sections: [] } },
  ];
  it("is told nothing is shared when no board names them, where a visitor is sent to sign in", () => {
    expect(pickBoard([boards[0]], null, sam)).toEqual({ kind: "nothing" });
    expect(pickBoard([boards[0]], null, null)).toEqual({ kind: "signIn" });
    expect(pickBoard([boards[0]], "ops", sam)).toEqual({ kind: "nothing" });
  });
  it("gets the board shared with their group as their home, and a Sign out in the menu", () => {
    const pick = pickBoard(boards, null, sam);
    expect(pick.kind === "board" && pick.board.id).toBe("family");
    expect(pickBoard(boards, "family", sam)).toEqual({ kind: "home" });
    expect(pickBoard(boards, "ops", sam)).toEqual({ kind: "notFound" });
    expect(navBoards(boards, sam).map((b) => b.href)).toEqual(["/"]);
    const source = { settings: { weather: { enabled: false }, statusChecks: false }, boards, widgets: [] };
    expect(navPages(source as never, sam).member).toBe(true);
    expect(navPages(source as never, null).member).toBe(false);
    expect(navPages(source as never, ADMIN_VIEW).member).toBe(false);
    // And who gets a Sign in (#450): nobody signed in.
    expect(navPages(source as never, null).visitor).toBe(true);
    expect(navPages(source as never, sam).visitor).toBe(false);
    expect(navPages(source as never, ADMIN_VIEW).visitor).toBe(false);
  });
});
