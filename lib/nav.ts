import type { Board, InstanceOf, Settings, WidgetInstance } from "./schema";
import { boardName } from "./schema";
import { resolveLayout } from "./layout";
import { isMember, visibleTo, type Viewing } from "./visibility";

// What navigation is derived from (a SiteConfig, or the public config).
type NavSource = { settings: Settings; boards: readonly Board[]; widgets: readonly WidgetInstance[] };

// The boards a visitor can open (#298), in order: every board for an admin,
// the public ones for everyone, and the private ones that name a member
// (#423).
export function visibleBoards<B extends Pick<Board, "visibility" | "audience">>(
  boards: readonly B[],
  viewer: Viewing | null
): B[] {
  return visibleTo(boards, viewer);
}

// A board link as the navigation shows it. The first board the visitor can
// open is their home page, at `/`.
// `icon` is "" for a board without one (#316).
export type NavBoard = { id: string; name: string; href: string; icon: string };
export function navBoards(boards: readonly Board[], viewer: Viewing | null): NavBoard[] {
  return visibleBoards(boards, viewer).map((b, i) => ({
    id: b.id,
    name: boardName(b),
    href: i === 0 ? "/" : `/b/${encodeURIComponent(b.id)}`,
    icon: b.icon ?? "",
  }));
}

// Which board a request for `/` (boardId null) or `/b/<boardId>` shows, for
// this viewer. A private board answers exactly like a missing one (not
// found), so its existence doesn't leak; a signed-out visitor who can open
// no board at all is sent to sign in, and a signed-in one who can open none
// is told nothing is shared with them (#423); the viewer's home board has
// one address, `/`.
export type BoardPick<B> =
  | { kind: "board"; board: B }
  | { kind: "notFound" }
  | { kind: "signIn" }
  | { kind: "nothing" }
  | { kind: "home" };
export function pickBoard<B extends Pick<Board, "id" | "visibility" | "audience">>(
  boards: readonly B[],
  boardId: string | null,
  viewer: Viewing | null
): BoardPick<B> {
  const visible = visibleBoards(boards, viewer);
  const home = visible[0];
  if (!home) return viewer ? { kind: "nothing" } : { kind: "signIn" };
  if (boardId === null) return { kind: "board", board: home };
  const board = visible.find((b) => b.id === boardId);
  if (!board) return { kind: "notFound" };
  return board === home ? { kind: "home" } : { kind: "board", board };
}

// The calendar widgets on show with a feed to fetch (#297): any number of
// them, and together they make up the /calendar page. A calendar counts when
// it's shown on a board this visitor can open, so one placed only on a
// private board stays off the page for everyone else.
export function activeCalendars(source: NavSource, viewer: Viewing | null): InstanceOf<"calendar">[] {
  const shown = new Set(
    visibleBoards(source.boards, viewer).flatMap((b) =>
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
  // A signed-in member (#423), who gets a Sign out in the menu: an admin
  // signs out from the portal.
  member: boolean;
  // Nobody signed in (#450): the menu offers Sign in.
  visitor: boolean;
  // A signed-in admin: the only one offered the admin portal and the
  // Monitor, which anyone else would only be bounced from.
  admin: boolean;
};
export function navPages(source: NavSource, viewer: Viewing | null): NavPages {
  return {
    boards: navBoards(source.boards, viewer),
    weather: source.settings.weather.enabled,
    status: source.settings.statusChecks,
    calendar: activeCalendars(source, viewer).length > 0,
    member: isMember(viewer),
    visitor: viewer === null,
    admin: viewer?.isAdmin === true,
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
