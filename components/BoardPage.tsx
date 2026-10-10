import { notFound, redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import FloatingNav from "@/components/FloatingNav";
import BoardKeys from "@/components/BoardKeys";
import { StatusProvider } from "@/components/StatusProvider";
import { EditModeProvider } from "@/components/EditMode";
import { resolveLayout, smallScreenTopGap } from "@/lib/layout";
import { readPublicConfig } from "@/lib/api-auth";
import { navPages, pickBoard } from "@/lib/nav";
import { boardName, monitoredApps } from "@/lib/schema";
import { loadHomeData } from "@/lib/widgets/load";

// One board, server-rendered (#298): the home page (`boardId` null, the first
// board this visitor can open) or /b/<id>. A private board is a 404 for
// anyone but the admin, the same answer as a board that doesn't exist, and
// a visitor who can open no board at all is sent to sign in.
export default async function BoardPage({
  boardId,
  edit,
}: {
  boardId: string | null;
  // ?edit=1, the deep link from admin Settings → Layout (admins only).
  edit: boolean;
}) {
  // readPublicConfig already dropped private apps/bookmarks for guests, and
  // everything derived from the lists (search matches, per-app bangs, group
  // headings) follows from the filtered arrays for free. `isAdmin` also
  // unlocks the layout-editor UI (saves go through the gated API).
  const { config, isAdmin } = await readPublicConfig();
  const { settings, apps, bookmarks } = config;

  const pick = pickBoard(config.boards, boardId, isAdmin);
  if (pick.kind === "signIn") redirect("/admin/login?next=/");
  if (pick.kind === "notFound") notFound();
  if (pick.kind === "home") redirect(edit && isAdmin ? "/?edit=1" : "/");
  const { board } = pick;

  const statusEnabled = settings.statusChecks && monitoredApps(apps).length > 0;
  // Resolved before the widget data loads: a loader can skip work for a widget
  // that's hidden (system stats on a guest render). A guest gets only what's
  // on show: the hidden rows, and the instances behind them (a notes card
  // placed only on a private board, say), never reach the page.
  const resolved = resolveLayout(board.layout.sections, config.widgets);
  // An apps widget showing only private apps (#299) has nothing for a guest.
  const privateOnly = new Set(
    config.widgets.filter((w) => w.type === "apps" && w.filter.private === "only").map((w) => w.id)
  );
  const widgets = isAdmin ? resolved : resolved.filter((w) => !w.hidden && !privateOnly.has(w.id));
  const onShow = new Set(widgets.map((w) => w.id));
  const data = await loadHomeData({
    settings,
    instances: isAdmin ? config.widgets : config.widgets.filter((w) => onShow.has(w.id)),
    apps,
    bookmarks,
    groups: config.groups,
    widgets,
    isAdmin,
    now: new Date(),
  });
  const nav = navPages(config, isAdmin);
  // The greeting is the page's heading; a board without one still names
  // itself to screen readers.
  const hasGreeting = widgets.some((w) => w.type === "greeting" && !w.hidden);

  // The gap above the first row of widgets, tunable from the layout editor
  // (Dashboard keeps these variables live while editing). The stored value
  // applies on large screens; smaller ones cap it at the stock 48px.
  const { topGap, scale, gap } = settings.layout;

  return (
    <main
      id="main-content"
      style={
        {
          "--top-gap": `${smallScreenTopGap(topGap)}px`,
          "--top-gap-lg": `${topGap}px`,
        } as React.CSSProperties
      }
      className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-12 px-6 pt-[var(--top-gap)] pb-24 sm:px-10 lg:pt-[var(--top-gap-lg)]"
    >
      {!hasGreeting && <h1 className="sr-only">{boardName(board)}</h1>}
      <StatusProvider enabled={statusEnabled}>
        <EditModeProvider isAdmin={isAdmin} initialEditing={isAdmin && edit}>
          <Dashboard
            // A fresh editor (state, undo stack) per board.
            key={board.id}
            boardId={board.id}
            isHome={board.id === config.boards[0].id}
            widgets={widgets}
            scale={scale}
            gap={gap}
            topGap={topGap}
            data={data}
          />
          <BoardKeys boards={nav.boards} />
          {settings.settingsButton && <FloatingNav {...nav} />}
        </EditModeProvider>
      </StatusProvider>
    </main>
  );
}
