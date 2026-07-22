import type { Metadata } from "next";
import { getSettings } from "@/lib/config";
import { getMonitorSnapshot } from "@/lib/monitor";
import MonitorDashboard from "@/components/monitor/MonitorDashboard";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Monitor" };
export const dynamic = "force-dynamic";

// The private control dashboard (#207): a read-only, admin-only view of the
// configured integrations (#190, #191). It lives under /admin so the proxy's
// session gate covers the page with no second check to forget, and its data
// plane (/api/monitor) sits behind the same gate — integration snapshots
// never reach an anonymous request, even by direct URL.
export default async function MonitorPage() {
  const settings = await getSettings();
  const snapshot = await getMonitorSnapshot(settings.integrations);
  return (
    <>
      <MonitorDashboard initial={snapshot} nav={navPages(settings)} />
      <FloatingNav {...navPages(settings)} />
    </>
  );
}
