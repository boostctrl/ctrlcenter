import Dashboard from "@/components/Dashboard";
import FloatingNav from "@/components/FloatingNav";
import { StatusProvider } from "@/components/StatusProvider";
import { EditModeProvider } from "@/components/EditMode";
import { resolveLayoutWidgets, smallScreenTopGap } from "@/lib/layout";
import { readPublicConfig } from "@/lib/api-auth";
import { navPages } from "@/lib/nav";
import { monitoredApps } from "@/lib/schema";
import { loadHomeData } from "@/lib/widgets/load";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // readPublicConfig already dropped private apps/bookmarks for guests, and
  // everything derived from the lists (search matches, per-app bangs, category
  // grouping) follows from the filtered arrays for free. `isAdmin` also
  // unlocks the layout-editor UI (saves go through the gated settings API);
  // ?edit=1 is the deep link from admin Settings → Layout.
  const { config, isAdmin } = await readPublicConfig();
  const { settings, apps, bookmarks } = config;

  const statusEnabled = settings.statusChecks && monitoredApps(apps).length > 0;
  // Resolved before the widget data loads: a loader can skip work for a widget
  // that's hidden (system stats on a guest render).
  const widgets = resolveLayoutWidgets(
    settings.layout.sections,
    settings.components,
    settings.feeds.map((f) => f.id)
  );
  const data = await loadHomeData({
    settings,
    apps,
    bookmarks,
    widgets,
    isAdmin,
    now: new Date(),
  });

  const params = await searchParams;
  const initialEditing = isAdmin && params.edit === "1";

  // The gap above the first row of widgets, tunable from the layout editor
  // (Dashboard keeps these variables live while editing). The stored value
  // applies on large screens; smaller ones cap it at the stock 48px.
  const topGap = settings.layout.topGap;

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
      <StatusProvider enabled={statusEnabled}>
        <EditModeProvider isAdmin={isAdmin} initialEditing={initialEditing}>
          <Dashboard
            widgets={widgets}
            scale={settings.layout.scale}
            gap={settings.layout.gap}
            topGap={topGap}
            data={data}
          />

          {settings.components.settingsButton && (
            <FloatingNav {...navPages(settings)} />
          )}
        </EditModeProvider>
      </StatusProvider>
    </main>
  );
}
