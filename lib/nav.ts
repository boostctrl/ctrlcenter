import type { Board, InstanceOf, Settings, WidgetInstance } from "./schema";
import { boardName } from "./schema";
import { resolveLayout } from "./layout";

// What navigation is derived from (a SiteConfig, or the public config).
type NavSource = { settings: Settings; boards: readonly Board[]; widgets: readonly WidgetInstance[] };

// The boards a visitor can open (#298), in order: every board for the admin,
// the public ones for everyone else.
export function visibleBoards<B extends Pick<Board, "visibility">>(boards: readonly B[], isAdmin: boolean): B[] {
  return boards.filter((b) => isAdmin || b.visibility === "public");
}

// A board link as the navigation shows it. The first board the visitor can
// open is their home page, at `/`.
export type NavBoard = { id: string; name: string; href: string };
export function navBoards(boards: readonly Board[], isAdmin: boolean): NavBoard[] {
  return visibleBoards(boards, isAdmin).map((b, i) => ({
    id: b.id,
    name: boardName(b),
    href: i === 0 ? "/" : `/b/${encodeURIComponent(b.id)}`,
  }));
}

// Which board a request for `/` (boardId null) or `/b/<boardId>` shows, as
// a visitor who is or isn't the admin. A private board answers exactly like
// a missing one (not found), so its existence doesn't leak; a visitor who
// can open no board at all is sent to sign in; the visitor's home board
// has one address, `/`.
export type BoardPick<B> =
  | { kind: "board"; board: B }
  | { kind: "notFound" }
  | { kind: "signIn" }
  | { kind: "home" };
export function pickBoard<B extends Pick<Board, "id" | "visibility">>(
  boards: readonly B[],
  boardId: string | null,
  isAdmin: boolean
): BoardPick<B> {
  const visible = visibleBoards(boards, isAdmin);
  const home = visible[0];
  if (!home) return { kind: "signIn" };
  if (boardId === null) return { kind: "board", board: home };
  const board = visible.find((b) => b.id === boardId);
  if (!board) return { kind: "notFound" };
  return board === home ? { kind: "home" } : { kind: "board", board };
}

// The calendar widgets on show with a feed to fetch (#297): any number of
// them, and together they make up the /calendar page. A calendar counts when
// it's shown on a board this visitor can open, so one placed only on a
// private board stays off the page for everyone else.
export function activeCalendars(source: NavSource, isAdmin: boolean): InstanceOf<"calendar">[] {
  const shown = new Set(
    visibleBoards(source.boards, isAdmin).flatMap((b) =>
      resolveLayout(b.layout.sections, source.widgets)
        .filter((w) => !w.hidden)
        .map((w) => w.id)
    )
  );
  return source.widgets.filter(
    (w): w is InstanceOf<"calendar"> =>
      w.type === "calendar" && shown.has(w.id) && w.url.trim() !== ""
  );
}

// What the navigation (the floating corner menu and the PageNav subpage
// strip) offers: the boards this visitor can open, and whether the
// feature pages are on. Help and Settings always appear, and each surface
// adds its own fixed links. One helper for both surfaces so they can't drift.
export type NavPages = {
  boards: NavBoard[];
  weather: boolean;
  status: boolean;
  calendar: boolean;
};
export function navPages(source: NavSource, isAdmin: boolean): NavPages {
  return {
    boards: navBoards(source.boards, isAdmin),
    weather: source.settings.weather.enabled,
    status: source.settings.statusChecks,
    calendar: activeCalendars(source, isAdmin).length > 0,
  };
}

// The anchor id a settings Card carries (components/admin/ui.tsx), derived
// from its title. Links elsewhere — the Monitor's "Set up" buttons (#277) —
// deep-link to one card via `#<id>`, which SettingsManager scrolls to on load.
export function settingsCardId(title: string): string {
  return (
    "settings-card-" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}
