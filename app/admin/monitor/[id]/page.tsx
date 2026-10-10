import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { requireAdminPage } from "@/lib/api-auth";
import { getServiceDetail } from "@/lib/monitor-detail";
import { integrationLabels } from "@/lib/services/ids";
import MonitorDetail from "@/components/monitor/MonitorDetail";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

// One integration's Monitor detail page (#208, by id since #300): the full lists, extra fields, and
// actions the glance card sheds. Lives under /admin so the proxy's session gate
// covers it, re-checks the session itself (so a proxy bypass can't serve it),
// and its data plane (/api/monitor/[id]) is gated the same two ways.
// Server-rendered from getServiceDetail, then kept fresh by polling that route.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const label = integrationLabels((await getSiteConfig()).integrations)[id];
  return { title: label ? `${label} — Monitor` : "Monitor" };
}

export default async function MonitorDetailPage({ params }: Params) {
  const { id } = await params;
  await requireAdminPage(`/admin/monitor/${encodeURIComponent(id)}`);
  // Admin-only (the proxy gates /admin), so every board is listed.
  const site = await getSiteConfig();
  // An unknown id 404s the same way an unconfigured integration does.
  const result = await getServiceDetail(id, site.integrations);
  if (!result) notFound();

  return (
    <>
      <MonitorDetail initial={result} nav={navPages(site, true)} />
      <FloatingNav {...navPages(site, true)} />
    </>
  );
}
