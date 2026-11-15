"use client";

import type { SeerrDetail as SeerrDetailData, SeerrRequest, SeerrRequestStatus } from "@/lib/services/seerr";
import { useNow } from "@/components/useNow";
import { Button } from "@/components/admin/ui";
import { useConfirm } from "@/components/admin/Confirm";
import { useMonitorAction } from "../actions";
import {
  EmptyRow,
  GlyphBubble,
  List,
  Pill,
  Row,
  Section,
  SegmentBar,
  Stat,
  StatGrid,
  ago,
  useMounted,
  type Tone,
} from "../kit";

// Seerr's page (#511), on the page kit (#508): the request counts, what's
// waiting for approval (with Approve and Deny when actions are on), and the
// latest requests with where each stands.

const STATUS: Record<SeerrRequestStatus, { tone: Tone; label: string }> = {
  pending: { tone: "warn", label: "Pending" },
  approved: { tone: "info", label: "Approved" },
  processing: { tone: "info", label: "Processing" },
  available: { tone: "up", label: "Available" },
  declined: { tone: "muted", label: "Declined" },
};

const kindOf = (r: SeerrRequest) => (r.type === "tv" ? "Series" : "Movie");

export default function SeerrDetail({
  data,
  actionsAllowed,
  onActed,
}: {
  data: SeerrDetailData;
  actionsAllowed: boolean;
  onActed: () => void;
}) {
  const mounted = useMounted();
  const clockNow = useNow(60_000);
  const now = mounted ? clockNow : null;
  const { busy, error, run } = useMonitorAction(onActed);
  const confirm = useConfirm();

  const approve = (r: SeerrRequest) => run(String(r.id), { service: "seerr", action: "approve", id: r.id });
  const deny = async (r: SeerrRequest) => {
    const ok = await confirm({
      title: "Deny request",
      message: `Deny “${r.title}”, requested by ${r.requester}?`,
      confirmLabel: "Deny",
      danger: true,
    });
    if (ok) run(String(r.id), { service: "seerr", action: "decline", id: r.id });
  };
  // The latest requests, less those already listed as waiting.
  const waitingIds = new Set(data.waiting.map((r) => r.id));
  const recent = data.requests.filter((r) => !waitingIds.has(r.id));
  const line = (r: SeerrRequest) =>
    [kindOf(r), r.requester, r.at !== null && now !== null ? ago(r.at, now) : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Waiting for approval"
          value={data.pending}
          tone={data.pending > 0 ? "warn" : undefined}
          hint={data.pending === 0 ? "Nothing to review" : actionsAllowed ? "Approve or deny below" : "Review them in Seerr"}
        />
        <Stat label="Processing" value={data.processing} hint="Approved, on their way" />
        <Stat label="Available" value={data.available} hint="Ready to watch" />
        <Stat
          label="All requests"
          value={data.totalRequests}
          visual={
            <SegmentBar
              parts={[
                { value: data.pending, tone: "pending" },
                { value: data.processing, tone: "processing" },
                { value: data.available, tone: "available" },
              ]}
            />
          }
        />
      </StatGrid>

      <Section
        title="Waiting for approval"
        count={data.waiting.length}
        description={error ? <span className="text-status-down">{error}</span> : undefined}
        flush
      >
        {data.waiting.length > 0 ? (
          <List>
            {data.waiting.map((r) => (
              <Row
                key={r.id}
                leading={<GlyphBubble name={r.type === "tv" ? "tv" : "film"} tone="warn" />}
                primary={r.title}
                title={r.title}
                secondary={line(r)}
                trailing={
                  actionsAllowed ? (
                    <span className="flex gap-2">
                      <Button variant="ghost" size="sm" disabled={busy === String(r.id)} onClick={() => approve(r)}>
                        Approve
                      </Button>
                      <Button variant="danger" size="sm" disabled={busy === String(r.id)} onClick={() => deny(r)}>
                        Deny
                      </Button>
                    </span>
                  ) : (
                    <Pill tone="warn">Pending</Pill>
                  )
                }
              />
            ))}
          </List>
        ) : (
          <EmptyRow>Nothing is waiting for approval.</EmptyRow>
        )}
      </Section>

      <Section title="Recent requests" count={recent.length} flush>
        {recent.length > 0 ? (
          <List>
            {recent.map((r) => (
              <Row
                key={r.id}
                leading={<GlyphBubble name={r.type === "tv" ? "tv" : "film"} tone={STATUS[r.status].tone} />}
                primary={r.title}
                title={r.title}
                secondary={line(r)}
                trailing={<Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>}
              />
            ))}
          </List>
        ) : (
          <EmptyRow>{data.waiting.length ? "No other recent requests." : "No requests yet."}</EmptyRow>
        )}
      </Section>
    </div>
  );
}
