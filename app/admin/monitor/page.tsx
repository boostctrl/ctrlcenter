import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { requireAdminPage } from "@/lib/api-auth";
import { getMonitorSnapshot } from "@/lib/monitor";
import MonitorDashboard from "@/components/monitor/MonitorDashboard";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Monitor" };
export const dynamic = "force-dynamic";

// The private control dashboard (#207): a read-only, admin-only view of the
// configured integrations (#190, #191). It lives under /admin so the proxy's
// session gate covers it, and the page re-checks the session itself so a proxy
// bypass can't serve it; its data plane (/api/monitor) is gated the same two
// ways — integration snapshots never reach an anonymous request, even by
// direct URL.
export default async function MonitorPage() {
  await requireAdminPage("/admin/monitor");
  const { settings, widgets } = await getSiteConfig();
  const snapshot = await getMonitorSnapshot(settings.integrations);
  return (
    <>
      <MonitorDashboard initial={snapshot} nav={navPages(settings, widgets)} />
      <FloatingNav {...navPages(settings, widgets)} />
    </>
  );
}
