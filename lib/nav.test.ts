import { describe, it, expect } from "vitest";
import { activeCalendars, navBoards, navPages, pickBoard, visibleBoards } from "./nav";
import { boardsSchema, newInstance, settingsSchema } from "./schema";

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
    expect(visibleBoards(boards, true).map((b) => b.id)).toEqual(["home", "infra", "media"]);
    expect(visibleBoards(boards, false).map((b) => b.id)).toEqual(["home", "media"]);
  });

  it("links the visitor's first board to / and names a nameless one by id, with its icon (#316)", () => {
    expect(navBoards(boards, false)).toEqual([
      { id: "home", name: "Home", href: "/", icon: "" },
      { id: "media", name: "media", href: "/b/media", icon: "jellyfin" },
    ]);
  });

  it("makes the first public board a guest's home when the first board is private", () => {
    const privateFirst = boardsSchema.parse([{ id: "mine", visibility: "private" }, { id: "family" }]);
    expect(navBoards(privateFirst, false)).toEqual([{ id: "family", name: "family", href: "/", icon: "" }]);
    expect(navBoards(privateFirst, true).map((b) => b.href)).toEqual(["/", "/b/family"]);
  });
});

describe("pickBoard", () => {
  it("shows the visitor's home board at /", () => {
    expect(pickBoard(boards, null, false)).toEqual({ kind: "board", board: boards[0] });
  });

  it("answers a private board like a missing one for a guest", () => {
    expect(pickBoard(boards, "infra", false)).toEqual({ kind: "notFound" });
    expect(pickBoard(boards, "nope", false)).toEqual({ kind: "notFound" });
    expect(pickBoard(boards, "infra", true)).toEqual({ kind: "board", board: boards[1] });
  });

  it("sends /b/<home> to /", () => {
    expect(pickBoard(boards, "home", true)).toEqual({ kind: "home" });
  });

  it("sends a visitor who can open no board to sign in", () => {
    const allPrivate = boardsSchema.parse([{ id: "home", visibility: "private" }]);
    expect(pickBoard(allPrivate, null, false)).toEqual({ kind: "signIn" });
    expect(pickBoard(allPrivate, null, true)).toEqual({ kind: "board", board: allPrivate[0] });
  });
});

describe("activeCalendars", () => {
  it("counts a calendar shown on a board the visitor can open, with a URL", () => {
    expect(activeCalendars(site, false).map((c) => c.id)).toEqual(["cal-public"]);
    expect(activeCalendars(site, true).map((c) => c.id)).toEqual(["cal-public", "cal-private"]);
  });

  it("drives the calendar link per visitor", () => {
    const onlyPrivate = { ...site, boards: boardsSchema.parse([{ id: "home" }, boards[1]]) };
    expect(navPages(onlyPrivate, false).calendar).toBe(false);
    expect(navPages(onlyPrivate, true).calendar).toBe(true);
  });
});
