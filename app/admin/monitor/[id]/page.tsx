import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { requireAdminPage } from "@/lib/api-auth";
import { getServiceDetail, isDetailService } from "@/lib/monitor-detail";
import { SERVICE_LABELS } from "@/lib/services/ids";
import MonitorDetail from "@/components/monitor/MonitorDetail";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

// One service's Monitor detail page (#208): the full lists, extra fields, and
// actions the glance card sheds. Lives under /admin so the proxy's session gate
// covers it, re-checks the session itself (so a proxy bypass can't serve it),
// and its data plane (/api/monitor/[id]) is gated the same two ways.
// Server-rendered from getServiceDetail, then kept fresh by polling that route.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return {
    title: isDetailService(id) ? `${SERVICE_LABELS[id]} — Monitor` : "Monitor",
  };
}

export default async function MonitorDetailPage({ params }: Params) {
  const { id } = await params;
  await requireAdminPage(`/admin/monitor/${encodeURIComponent(id)}`);
  // Unknown id, or a service without a detail view yet, 404s — the same way an
  // unconfigured one does below, so the route can't be used to probe which
  // services exist.
  if (!isDetailService(id)) notFound();
  // Admin-only (the proxy gates /admin), so every board is listed.
  const site = await getSiteConfig();
  const result = await getServiceDetail(id, site.settings.integrations);
  if (!result) notFound();

  return (
    <>
      <MonitorDetail initial={result} nav={navPages(site, true)} />
      <FloatingNav {...navPages(site, true)} />
    </>
  );
}
