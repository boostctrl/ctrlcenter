import type { Metadata } from "next";
import Link from "next/link";
import { readPublicConfig } from "@/lib/api-auth";
import StatusPage from "@/components/StatusPage";
import StatusAnnouncements from "@/components/StatusAnnouncements";
import PageNav from "@/components/PageNav";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";
import { monitoredApps } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Status",
  // Lets feed readers find the incidents feed from the page URL (#295).
  alternates: { types: { "application/atom+xml": "/status/feed.xml" } },
};
export const dynamic = "force-dynamic";

export default async function StatusRoute() {
  // readPublicConfig already filtered private apps out of the server-rendered
  // list for guests — same visibility rule as the home page.
  const { config } = await readPublicConfig();
  const { settings } = config;
  // Only the apps that get checks have a row (#296).
  const items = monitoredApps(config.apps).map((a) => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    subtitle: a.subtitle,
    url: a.url,
  }));

  return (
    <>
      <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
        <div>
          <PageNav current="status" {...navPages(settings, config.widgets)} />
          <h1 className="mt-3 text-3xl font-bold">Status</h1>
        </div>

        {settings.statusChecks ? (
          // Announcements render inside StatusPage, between its summary banner
          // and the per-app rows (the Statuspage pattern, per #118).
          <StatusPage
            apps={items}
            defaultRange={settings.statusDefaultRange}
            announcements={settings.statusAnnouncements}
          />
        ) : (
          <>
            {/* With checks off there's no summary banner to slot under, but a
                maintenance notice is content in its own right — it renders
                above the "turned off" note. */}
            <StatusAnnouncements announcements={settings.statusAnnouncements} />
            <p className="text-ink-50">
              Status checks are turned off.{" "}
              <Link href="/admin" className="underline hover:text-ink-80">
                Enable them in admin settings
              </Link>
              .
            </p>
          </>
        )}

        <p className="text-sm text-ink-50">
          Get outages and announcements in a feed reader:{" "}
          <a href="/status/feed.xml" className="underline hover:text-ink-80">
            subscribe to the status feed
          </a>
          .
        </p>
      </main>
      {settings.settingsButton && (
        <FloatingNav {...navPages(settings, config.widgets)} />
      )}
    </>
  );
}
