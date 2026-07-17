"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { ChipGroup } from "./ChipGroup";
import { ConfirmProvider, useConfirm } from "./admin/Confirm";
import { RenameButton, RenameField } from "./InlineRename";
import { useVisitorPrefs } from "./PrefsProvider";
import {
  StatusTimeline,
  StateDot,
  host,
  relativeTime,
  downDuration,
  instantLabel,
} from "./StatusTimeline";
import {
  formatBarLabel,
  formatSince,
  CHECK_TYPES,
  STATUS_RANGES,
  STATUS_RANGE_MS,
  type CheckType,
  type StatusRangeKey,
  type AppStatus,
  type StatusResponse,
  type AppDetail,
  type StatusDetailResponse,
  type UptimeWindows,
  type LatencyWindows,
  type OutageEntry,
} from "@/lib/status";
import type { StatusAppMeta } from "./StatusPage";

const POLL_MS = 30_000;

// Per-service detail body (#150): everything the recorded history supports for
// one app, at a resolution the row strips can't afford. The /status page's
// cards stay lean on purpose — analytics land here instead of as more lines on
// the rows (#137/#141 showed how fast the right column gets busy).

const fmtPct = (u: number | null) => (u == null ? "—" : `${u.toFixed(1)}%`);

// A completed duration ("1h 12m") from a length in ms — downDuration measured
// from a synthetic start.
const fmtDuration = (ms: number) => downDuration(0, ms);

// Simple response-time chart: one column per bucket, height scaled to the
// window's max. Static bars (no motion), tooltips per column, and one spoken
// summary for the whole chart — same posture as the uptime strip (#116), whose
// arrow-key traversal covers the shared buckets (each uptime bucket's readout
// already includes its latency).
function LatencyChart({
  points,
  timeZone,
  range,
}: {
  points: { at: string; ms: number | null }[];
  timeZone: string;
  range: StatusRangeKey;
}) {
  const withMs = points.filter(
    (p): p is { at: string; ms: number } => p.ms != null
  );
  if (withMs.length === 0) {
    return <p className="text-sm text-fg/40">No response-time samples yet.</p>;
  }
  const max = Math.max(...withMs.map((p) => p.ms));
  const bucketMs = STATUS_RANGE_MS[range] / points.length;
  const rangeLabel = STATUS_RANGES.find((r) => r.key === range)?.label ?? "";
  return (
    <div
      role="img"
      aria-label={`${rangeLabel} response-time chart: peaks at ${max} ms`}
      className="flex h-24 items-end gap-px sm:gap-[3px]"
    >
      {points.map((p, i) => (
        <span
          key={`${p.at}-${i}`}
          title={
            p.ms == null
              ? `${formatBarLabel(p.at, timeZone, bucketMs)}: no samples`
              : `${formatBarLabel(p.at, timeZone, bucketMs)}: avg ${p.ms}ms`
          }
          className={`min-w-0 flex-1 rounded-t-sm ${
            p.ms == null
              ? "self-stretch bg-fg/[0.04]"
              : "bg-gradient-to-t from-[var(--accent-from)] to-[var(--accent-to)] opacity-70"
          }`}
          style={
            p.ms == null
              ? undefined
              : { height: `${Math.max(4, (p.ms / max) * 100)}%` }
          }
        />
      ))}
    </div>
  );
}

function OutageRow({
  outage,
  now,
  timeZone,
  isAdmin,
  onSaveNote,
}: {
  outage: OutageEntry;
  now: number;
  timeZone: string;
  isAdmin: boolean;
  onSaveNote: (startMs: number, note: string) => Promise<boolean>;
}) {
  const ongoing = outage.endMs === null;
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = useConfirm();
  // Notes anchor to recorded outages (#175) by their exact start instant;
  // approximate entries and the ongoing one have no stable identity yet, so
  // they get no affordance (a live incident is what announcements are for).
  const editable = isAdmin && outage.recorded === true;
  const noteLabel = `incident note for the outage of ${instantLabel(outage.startMs, timeZone)}`;

  const beginEdit = () => {
    setFailed(false);
    setEditing(true);
  };

  const commit = async (raw: string) => {
    const note = raw.trim();
    setEditing(false);
    if (note === (outage.note ?? "")) return;
    if (note === "") {
      const ok = await confirm({
        title: "Delete this note?",
        message: "The outage entry itself stays in the log.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    setFailed(!(await onSaveNote(outage.startMs, note)));
  };

  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-fg/80">
          {instantLabel(outage.startMs, timeZone)}
          {" – "}
          {ongoing ? (
            <span className="text-red-400">ongoing</span>
          ) : (
            instantLabel(outage.endMs!, timeZone)
          )}
          {/* Hour-granular entries derived from old buckets say so instead of
              implying to-the-minute knowledge the data doesn't have. */}
          {!outage.exact && (
            <span className="text-xs text-fg/40"> · approximate</span>
          )}
        </span>
        <span
          className={`text-sm tabular-nums ${
            ongoing ? "text-red-400" : "text-fg/55"
          }`}
        >
          down {ongoing ? downDuration(outage.startMs, now) : fmtDuration(outage.downMs)}
        </span>
      </div>
      {editing ? (
        <RenameField
          initialValue={outage.note ?? ""}
          onCommit={commit}
          onCancel={() => setEditing(false)}
          label={`Edit ${noteLabel}`}
          maxLength={500}
          placeholder="What happened? e.g. planned maintenance"
          className="accent-focus w-full max-w-md rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-fg placeholder-fg/30 outline-none"
        />
      ) : (
        (outage.note || editable) && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {outage.note ? (
              <>
                <p className="text-sm text-fg/55">{outage.note}</p>
                {editable && (
                  <RenameButton
                    label={`Edit ${noteLabel}`}
                    onClick={beginEdit}
                    className="shrink-0 self-center text-fg/35 hover:text-fg/80"
                  />
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={beginEdit}
                className="text-xs text-fg/40 underline decoration-fg/20 underline-offset-2 hover:text-fg/75"
              >
                Add note
              </button>
            )}
            {failed && (
              <p className="text-xs text-red-400">Couldn&apos;t save the note.</p>
            )}
          </div>
        )
      )}
    </li>
  );
}

export default function StatusDetail({
  app,
  check,
  defaultRange,
  isAdmin,
}: {
  app: StatusAppMeta;
  // Read-only check context: how this app's reachability is measured.
  check: { type: CheckType; expectStatus: string; port: number | null };
  defaultRange: StatusRangeKey;
  // Unlocks the incident-note editor on the outage log (#176). Presentation-
  // only trust decided server-side; the note API re-checks every write.
  isAdmin: boolean;
}) {
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [live, setLive] = useState<AppStatus | undefined>(undefined);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [range, setRange] = useState<StatusRangeKey>(defaultRange);
  const { timezone } = useVisitorPrefs();

  const load = useCallback(async () => {
    try {
      const [statusRes, detailRes] = await Promise.all([
        fetch("/api/status", { cache: "no-store" }),
        fetch(
          `/api/status/history/${app.id}?tz=${encodeURIComponent(timezone)}`,
          { cache: "no-store" }
        ),
      ]);
      if (statusRes.ok) {
        const data: StatusResponse = await statusRes.json();
        setLive(data.results.find((r) => r.id === app.id));
        setCheckedAt(data.checkedAt);
        setNow(Date.now());
      }
      if (detailRes.ok) {
        const d: StatusDetailResponse = await detailRes.json();
        setDetail(d.app);
      }
    } catch {
      // Leave the previous data in place on a network hiccup.
    }
  }, [app.id, timezone]);

  // Write one outage's incident note (#176) and refresh the log so the row
  // shows what the server accepted. `false` surfaces as the row's inline
  // "couldn't save" notice — an expired session or an entry that aged out.
  const saveNote = useCallback(
    async (startMs: number, note: string) => {
      try {
        const res = await fetch(`/api/status/history/${app.id}/note`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ start: startMs, note }),
        });
        if (!res.ok) return false;
        await load();
        return true;
      } catch {
        return false;
      }
    },
    [app.id, load]
  );

  useEffect(() => {
    // Initial fetch on mount, then the same 30s poll cadence as /status.
    // load() touches state synchronously, which is the intended behavior here
    // (kick off the first poll right away) — same posture as StatusPage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const uptime = detail ? detail.uptime[range as keyof UptimeWindows] : null;
  const latency = detail ? detail.latency[range as keyof LatencyWindows] : null;
  const series = detail?.series[range] ?? [];
  const windowMs = STATUS_RANGE_MS[range];
  const coverageSince =
    detail && detail.since != null && detail.since - (now - windowMs) > windowMs * 0.05
      ? detail.since
      : null;
  const outageStart =
    live && !live.up && detail?.downSince != null ? detail.downSince : null;
  const dur = outageStart != null ? downDuration(outageStart, now) : null;
  const liveDetail = !live
    ? "Checking…"
    : live.up
      ? `${live.status ? `HTTP ${live.status}` : "Reachable"} · ${live.ms}ms`
      : dur
        ? live.status
          ? `Down for ${dur} · HTTP ${live.status}`
          : `Unreachable for ${dur}`
        : live.status
          ? `Down · HTTP ${live.status}`
          : "Unreachable";
  const rangeLabel = STATUS_RANGES.find((r) => r.key === range)!.label;
  const checkTypeLabel =
    CHECK_TYPES.find((c) => c.key === check.type)?.label ?? check.type;

  return (
    <div className="space-y-4">
      {/* Live header: the same identity + state the row shows, full width. */}
      <div
        className={`glass-card flex items-center gap-4 px-5 py-4 ${
          live && !live.up ? "ring-1 ring-red-400/30" : ""
        }`}
      >
        <StateDot status={live} />
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg/5 ring-1 ring-fg/10">
          <Icon icon={app.icon} name={app.name} size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-fg/55">
            {app.subtitle ? `${app.subtitle} · ${host(app.url)}` : host(app.url)}
          </p>
          <p
            title={
              outageStart != null
                ? `down since ${instantLabel(outageStart, timezone)}`
                : undefined
            }
            className={`text-sm ${live && !live.up ? "text-red-400" : "text-fg/70"}`}
          >
            {liveDetail}
          </p>
        </div>
        {checkedAt !== null && (
          <p className="shrink-0 text-xs text-fg/40">
            Updated {relativeTime(checkedAt, now)}
          </p>
        )}
      </div>

      {/* Uptime per range — every window at once, each with its own honesty
          note when the data doesn't reach back that far (#112). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_RANGES.map((r) => {
          const pct = detail ? detail.uptime[r.key as keyof UptimeWindows] : null;
          const lat = detail ? detail.latency[r.key as keyof LatencyWindows] : null;
          const since =
            detail &&
            detail.since != null &&
            detail.since - (now - STATUS_RANGE_MS[r.key]) >
              STATUS_RANGE_MS[r.key] * 0.05
              ? detail.since
              : null;
          return (
            <div key={r.key} className="glass-card px-4 py-3">
              <p className="text-xs text-fg/45">{r.label}</p>
              <p className="text-lg font-semibold tabular-nums">{fmtPct(pct)}</p>
              <p className="text-xs text-fg/45 tabular-nums">
                {lat ? `avg ${lat.avg} ms · max ${lat.max} ms` : " "}
              </p>
              {since != null && (
                <p className="text-xs text-fg/45">
                  since {formatSince(since, timezone, r.key)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* The large uptime graph. */}
      <div className="glass-card space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-fg/70">
            Uptime over {rangeLabel}
            <span className="ml-2 font-semibold tabular-nums text-fg/90">
              {fmtPct(uptime)}
            </span>
            {coverageSince != null && (
              <span className="ml-2 text-xs text-fg/45">
                since {formatSince(coverageSince, timezone, range)}
              </span>
            )}
          </p>
          <ChipGroup
            label="Uptime range"
            size="xs"
            options={STATUS_RANGES.map((r) => ({ value: r.key, label: r.label }))}
            value={range}
            onChange={setRange}
          />
        </div>
        {series.length > 0 ? (
          <StatusTimeline
            points={series}
            timeZone={timezone}
            range={range}
            uptimePct={uptime}
            detail
          />
        ) : (
          <p className="text-sm text-fg/40">No recorded history yet.</p>
        )}
      </div>

      {/* Response time over the same window. */}
      <div className="glass-card space-y-3 px-5 py-4">
        <p className="text-sm text-fg/70">
          Response time over {rangeLabel}
          {latency && (
            <span className="ml-2 text-xs tabular-nums text-fg/45">
              avg {latency.avg} ms · max {latency.max} ms
            </span>
          )}
        </p>
        <LatencyChart points={series} timeZone={timezone} range={range} />
      </div>

      {/* Outage log, newest first. The ConfirmProvider hosts the note
          editor's delete confirmation; it renders nothing until asked. */}
      <ConfirmProvider>
        <div className="glass-card px-5 py-4">
          <p className="mb-2 text-sm text-fg/70">Outages</p>
          {detail && detail.outages.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {detail.outages.map((o) => (
                <OutageRow
                  key={`${o.startMs}`}
                  outage={o}
                  now={now}
                  timeZone={timezone}
                  isAdmin={isAdmin}
                  onSaveNote={saveNote}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">
              No outages in the recorded history.
            </p>
          )}
        </div>
      </ConfirmProvider>

      {/* How this app is checked — read-only context for the graphs above. */}
      <div className="glass-card px-5 py-4">
        <p className="mb-2 text-sm text-fg/70">Check configuration</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-fg/45">Method</dt>
          <dd className="text-fg/80">{checkTypeLabel}</dd>
          <dt className="text-fg/45">Target</dt>
          <dd className="truncate text-fg/80">{host(app.url)}</dd>
          {check.type === "tcp" && check.port != null && (
            <>
              <dt className="text-fg/45">Port</dt>
              <dd className="tabular-nums text-fg/80">{check.port}</dd>
            </>
          )}
          {(check.type === "http" || check.type === "keyword") && (
            <>
              <dt className="text-fg/45">Expected status</dt>
              <dd className="tabular-nums text-fg/80">
                {check.expectStatus.trim() === ""
                  ? "Any response counts as up"
                  : check.expectStatus}
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
