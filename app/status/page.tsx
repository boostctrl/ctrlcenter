import type { Metadata } from "next";
import Link from "next/link";
import { readConfig } from "@/lib/config";
import StatusPage from "@/components/StatusPage";
import StatusAnnouncements from "@/components/StatusAnnouncements";
import BackHome from "@/components/BackHome";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

export default async function StatusRoute() {
  const { settings, apps } = await readConfig();
  const items = apps.map((a) => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    subtitle: a.subtitle,
    url: a.url,
  }));

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <BackHome />
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
            <p className="text-fg/50">
              Status checks are turned off.{" "}
              <Link href="/admin" className="underline hover:text-fg/80">
                Enable them in admin settings
              </Link>
              .
            </p>
          </>
        )}
      </main>
      {settings.components.settingsButton && (
        <FloatingNav {...navPages(settings)} />
      )}
    </>
  );
}
