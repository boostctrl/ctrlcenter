"use client";

import { useSyncExternalStore } from "react";
import type { ServiceStatus } from "@/lib/monitor";
import type {
  SeerrSnapshot,
  SeerrRequest,
  SeerrRequestStatus,
} from "@/lib/services/seerr";
import { Button } from "@/components/admin/ui";
import { useConfirm } from "@/components/admin/Confirm";
import MonitorCard from "./MonitorCard";
import { useMonitorAction } from "./actions";

// Seerr's card on the Monitor page (#196): what's waiting on approval —
// pending count and the most recent requests, each with its title, requester,
// and standing. When actions are turned on (#202) each pending request gains
// Approve and Deny (deny confirmed first).

// The relative "added" label depends on the viewer's clock, so it renders
// only after mount to avoid a hydration mismatch (matches ArrCard).
const subscribeNever = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

function relTime(at: number | null): string {
  if (at === null) return "";
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STATUS_LABELS: Record<SeerrRequestStatus, string> = {
  pending: "pending",
  declined: "declined",
  approved: "approved",
  processing: "processing",
  available: "available",
};

const STATUS_TONES: Record<SeerrRequestStatus, string> = {
  pending: "text-amber-400/90",
  declined: "text-red-400",
  approved: "text-sky-400/80",
  processing: "text-sky-400/80",
  available: "text-emerald-400/90",
};

function RequestRow({
  request,
  meta,
  actions,
}: {
  request: SeerrRequest;
  meta: string;
  // Present only when actions are enabled AND the request is pending.
  actions?: {
    busy: boolean;
    onApprove: () => void;
    onDeny: () => void;
  };
}) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-fg/80" title={request.title}>
          {request.title}
          <span className="text-fg/45"> · {request.requester}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          <span className={STATUS_TONES[request.status]}>
            {STATUS_LABELS[request.status]}
          </span>
          {meta && <span className="text-fg/50">{meta}</span>}
        </span>
      </div>
      {actions && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={actions.busy}
            onClick={actions.onApprove}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={actions.busy}
            onClick={actions.onDeny}
          >
            Deny
          </Button>
        </div>
      )}
    </li>
  );
}

export default function SeerrCard({
  status,
  onActed,
}: {
  status: ServiceStatus<SeerrSnapshot>;
  onActed?: () => void;
}) {
  const mounted = useMounted();
  const data = status.data;
  const { busy, error, run } = useMonitorAction(onActed);
  const confirm = useConfirm();

  const approve = (r: SeerrRequest) =>
    run(String(r.id), { service: "seerr", action: "approve", id: r.id });
  const deny = async (r: SeerrRequest) => {
    const ok = await confirm({
      title: "Deny request",
      message: `Deny “${r.title}”, requested by ${r.requester}?`,
      confirmLabel: "Deny",
      danger: true,
    });
    if (ok) run(String(r.id), { service: "seerr", action: "decline", id: r.id });
  };

  return (
    <MonitorCard title="Seerr" status={status}>
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-fg/90">
              {data.pending}
              <span className="ml-1.5 text-xs font-normal text-fg/50">
                pending
              </span>
            </span>
            <span className="text-xs text-fg/50">
              {data.processing} processing · {data.available} available ·{" "}
              {data.totalRequests} total
            </span>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {data.requests.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium tracking-wide text-fg/40 uppercase">
                Recent requests
              </p>
              {/* Two independent columns on wide screens so the list fills the
                  width; each column packs its own rows, so the taller pending
                  rows (with Approve/Deny) don't leave gaps beside shorter ones. */}
              <div className="grid gap-x-12 sm:grid-cols-2">
                {(() => {
                  const mid = Math.ceil(data.requests.length / 2);
                  return [
                    data.requests.slice(0, mid),
                    data.requests.slice(mid),
                  ].map((col, ci) => (
                    <ul key={ci} className="flex flex-col gap-2.5">
                      {col.map((r, i) => (
                        <RequestRow
                          key={`${r.id}-${r.title}-${i}`}
                          request={r}
                          meta={mounted ? relTime(r.at) : ""}
                          actions={
                            status.actionsAllowed && r.status === "pending"
                              ? {
                                  busy: busy === String(r.id),
                                  onApprove: () => approve(r),
                                  onDeny: () => deny(r),
                                }
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  ));
                })()}
              </div>
            </div>
          ) : (
            <p className="text-sm text-fg/40">No requests yet.</p>
          )}
        </>
      )}
    </MonitorCard>
  );
}
