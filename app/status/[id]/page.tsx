import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readPublicConfig } from "@/lib/api-auth";
import StatusDetail from "@/components/StatusDetail";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

// Per-service status detail (#150): a large uptime graph, latency analytics,
// the windowed percentages for every range, the outage log, and the check's
// read-only configuration. Deep-linkable; the /status rows link here.
//
// Visibility is existence: readPublicConfig pre-filters private apps for
// guests, so an unknown id and a private one 404 identically — the page can't
// be used to probe which private apps exist (#133/#147).
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const { config } = await readPublicConfig();
  const app = config.apps.find((a) => a.id === id);
  return { title: app ? `${app.name} status` : "Status" };
}

export default async function StatusDetailRoute({ params }: Params) {
  const { id } = await params;
  const { config } = await readPublicConfig();
  const { settings } = config;
  const app = config.apps.find((a) => a.id === id);
  if (!app) notFound();

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <Link
            href="/status"
            className="text-sm text-fg/50 transition-colors hover:text-fg/80"
          >
            Status
          </Link>
          <h1 className="mt-3 text-3xl font-bold">{app.name}</h1>
        </div>

        {settings.statusChecks ? (
          <StatusDetail
            app={{
              id: app.id,
              name: app.name,
              icon: app.icon,
              subtitle: app.subtitle,
              url: app.url,
            }}
            check={{
              type: app.checkType,
              expectStatus: app.expectStatus,
              port: app.port ?? null,
            }}
            defaultRange={settings.statusDefaultRange}
          />
        ) : (
          <p className="text-fg/50">
            Status checks are turned off.{" "}
            <Link href="/admin" className="underline hover:text-fg/80">
              Enable them in admin settings
            </Link>
            .
          </p>
        )}
      </main>
      {settings.components.settingsButton && (
        <FloatingNav {...navPages(settings)} />
      )}
    </>
  );
}
