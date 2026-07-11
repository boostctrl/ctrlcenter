import { readConfigInternal } from "@/lib/config";
import AdminDashboard from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const config = await readConfigInternal();

  return (
    <AdminDashboard
      initialApps={config.apps}
      initialBookmarks={config.bookmarks}
      initialSettings={config.settings}
      initialThemes={config.themes}
    />
  );
}
