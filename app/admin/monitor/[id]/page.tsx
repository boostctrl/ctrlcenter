import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/config";
import { getServiceDetail, isDetailService } from "@/lib/monitor-detail";
import { SERVICE_LABELS } from "@/lib/services/ids";
import MonitorDetail from "@/components/monitor/MonitorDetail";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

// One service's Monitor detail page (#208): the full lists, extra fields, and
// actions the glance card sheds. Lives under /admin so the proxy's session gate
// covers it with no second check, and its data plane (/api/monitor/[id]) sits
// behind the same gate. Server-rendered from getServiceDetail, then kept fresh
// by polling that route.
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
  // Unknown id, or a service without a detail view yet, 404s — the same way an
  // unconfigured one does below, so the route can't be used to probe which
  // services exist.
  if (!isDetailService(id)) notFound();
  const settings = await getSettings();
  const result = await getServiceDetail(id, settings.integrations);
  if (!result) notFound();

  return (
    <>
      <MonitorDetail initial={result} nav={navPages(settings)} />
      <FloatingNav {...navPages(settings)} />
    </>
  );
}
