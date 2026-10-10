import { redirect } from "next/navigation";
import { readConfigInternal } from "@/lib/config";
import { requireAdminPage } from "@/lib/api-auth";
import { resolveThemePacks } from "@/lib/theme";
import { needsSetup } from "@/lib/setup";
import SetupWizard from "@/components/admin/SetupWizard";

export const dynamic = "force-dynamic";

// The first-run setup (#304). Only while it's due: once finished or skipped
// (or once anything has been added), this goes to the admin page instead.
export default async function SetupPage() {
  const config = await readConfigInternal();
  await requireAdminPage("/admin/setup", config.auth.passwordHash);
  if (!needsSetup(config)) redirect("/admin");
  return <SetupWizard settings={config.settings} packs={resolveThemePacks(config.themes)} />;
}
