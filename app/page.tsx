import { readConfig } from "@/lib/config";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const config = await readConfig();
  const { settings, apps, bookmarks } = config;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-12 sm:px-10 lg:py-16">
      <Header settings={settings} />

      <Dashboard
        apps={apps}
        bookmarks={bookmarks}
        statusEnabled={settings.statusChecks}
        search={settings.search}
      />
    </main>
  );
}
