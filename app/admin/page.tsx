import { readConfigInternal } from "@/lib/config";
import AdminDashboard from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";

// The ?tab / ?section deep-link params are read HERE, server-side, and handed
// down as plain props — not via useSearchParams in the client tree. That hook
// would force a Suspense boundary around the dashboard, and its streamed
// segment can lose the reveal-vs-hydration race, leaving an orphaned hidden
// copy of the whole admin page in the DOM (#132).
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = await readConfigInternal();
  const params = await searchParams;

  return (
    <AdminDashboard
      initialApps={config.apps}
      initialBookmarks={config.bookmarks}
      initialSettings={config.settings}
      initialThemes={config.themes}
      // Only the boolean crosses to the client — never the TOTP secret (#198).
      initialTwoFactorEnabled={config.auth.totp.enabled}
      initialTab={typeof params.tab === "string" ? params.tab : undefined}
      initialSection={
        typeof params.section === "string" ? params.section : undefined
      }
    />
  );
}
