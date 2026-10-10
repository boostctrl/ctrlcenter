import { redirect } from "next/navigation";
import { readConfigInternal, readUpgradeNotice } from "@/lib/config";
import { needsSetup } from "@/lib/setup";
import { requireAdminPage } from "@/lib/api-auth";
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
  await requireAdminPage("/admin", config.auth.passwordHash);
  // A fresh install starts with the first-run setup (#304).
  if (needsSetup(config)) redirect("/admin/setup");
  const params = await searchParams;
  // The one-time "upgraded to 3.0" banner (#306), until dismissed.
  const upgradeNotice = await readUpgradeNotice();

  return (
    <AdminDashboard
      initialApps={config.apps}
      initialBookmarks={config.bookmarks}
      initialSettings={config.settings}
      initialWidgets={config.widgets}
      initialBoards={config.boards}
      initialGroups={config.groups}
      initialIntegrations={config.integrations}
      initialThemes={config.themes}
      // Only the boolean crosses to the client — never the TOTP secret (#198).
      initialTwoFactorEnabled={config.auth.totp.enabled}
      upgradeNotice={upgradeNotice}
      initialTab={typeof params.tab === "string" ? params.tab : undefined}
      initialSection={
        typeof params.section === "string" ? params.section : undefined
      }
    />
  );
}
