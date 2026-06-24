import type { Metadata } from "next";
import Link from "next/link";
import { readConfig } from "@/lib/config";
import StatusPage from "@/components/StatusPage";

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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-fg/50 transition-colors hover:text-fg/80"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-3xl font-bold">Status</h1>
      </div>

      {settings.statusChecks ? (
        <StatusPage apps={items} />
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
  );
}
