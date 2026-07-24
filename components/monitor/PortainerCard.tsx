"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { ServiceStatus } from "@/lib/monitor";
import type {
  PortainerSnapshot,
  PortainerEndpoint,
  PortainerContainer,
} from "@/lib/services/portainer";
import { Button } from "@/components/admin/ui";
import { useConfirm } from "@/components/admin/Confirm";
import { useFocusTrap } from "@/components/admin/useFocusTrap";
import MonitorCard from "./MonitorCard";
import {
  useMonitorAction,
  fetchContainers,
  fetchContainerLogs,
} from "./actions";

// Portainer's card on the Monitor page (#197): container states grouped by
// environment — the health signal for the apps with no API of their own. When
// actions are turned on (#203) each environment expands to its container list,
// where a container can be started, stopped, or restarted (stop/restart
// confirmed) and its logs viewed read-only.

function stateTone(state: string): string {
  if (state === "running") return "text-emerald-400/90";
  if (state === "exited" || state === "dead" || state === "created")
    return "text-fg/45";
  return "text-amber-400/80"; // restarting, paused, removing, …
}

// Read-only, scrollable, capped log tail. Portaled to the body: the card is a
// glass-card (backdrop-filter), which would otherwise trap this fixed overlay.
function LogModal({
  name,
  logs,
  loading,
  error,
  onClose,
}: {
  name: string;
  logs: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-label={`Logs — ${name}`}
        className="glass-card flex h-[70vh] w-full max-w-3xl flex-col gap-3 p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-semibold" title={name}>
            Logs — {name}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-fg/50">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-black/70 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-neutral-200">
            {logs.trim() ? logs : "No log output."}
          </pre>
        )}
      </div>
    </div>,
    document.body
  );
}

function ContainerRow({
  container,
  busy,
  onAction,
  onLogs,
}: {
  container: PortainerContainer;
  busy: boolean;
  onAction: (
    action: "start" | "stop" | "restart",
    c: PortainerContainer
  ) => void;
  onLogs: (c: PortainerContainer) => void;
}) {
  const running = container.state === "running";
  return (
    <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-fg/80" title={container.name}>
          {container.name}
        </span>
        <span className={`shrink-0 text-xs ${stateTone(container.state)}`}>
          {container.status || container.state}
        </span>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {running ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction("restart", container)}>
              Restart
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => onAction("stop", container)}>
              Stop
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction("start", container)}>
            Start
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onLogs(container)}>
          Logs
        </Button>
      </div>
    </li>
  );
}

function EndpointRow({
  endpoint,
  expandable,
  expanded,
  onToggle,
  children,
}: {
  endpoint: PortainerEndpoint;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const summary = (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-fg/80" title={endpoint.name}>
        {endpoint.name}
      </span>
      {endpoint.hasSnapshot ? (
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          <span className="text-emerald-400/90">{endpoint.running} up</span>
          {endpoint.stopped > 0 && (
            <span className="text-fg/50">{endpoint.stopped} stopped</span>
          )}
          {endpoint.unhealthy > 0 && (
            <span className="text-red-400">{endpoint.unhealthy} unhealthy</span>
          )}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-fg/40">no snapshot</span>
      )}
    </div>
  );
  return (
    <li className="flex flex-col gap-2">
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="w-full rounded-lg text-left transition-colors hover:bg-fg/5"
        >
          {summary}
        </button>
      ) : (
        summary
      )}
      {children}
    </li>
  );
}

export default function PortainerCard({
  status,
  onActed,
}: {
  status: ServiceStatus<PortainerSnapshot>;
  onActed?: () => void;
}) {
  const data = status.data;
  const confirm = useConfirm();
  const { busy, error, run } = useMonitorAction(onActed);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [containers, setContainers] = useState<PortainerContainer[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [logTarget, setLogTarget] = useState<PortainerContainer | null>(null);
  const [logs, setLogs] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const loadContainers = useCallback(async (endpointId: number) => {
    setLoadingList(true);
    setListError(null);
    const res = await fetchContainers(endpointId);
    setLoadingList(false);
    if (res.error) setListError(res.error);
    else setContainers(res.containers ?? []);
  }, []);

  const toggle = (endpointId: number) => {
    if (expanded === endpointId) {
      setExpanded(null);
      return;
    }
    setExpanded(endpointId);
    setContainers([]);
    loadContainers(endpointId);
  };

  const onAction = async (
    endpointId: number,
    action: "start" | "stop" | "restart",
    c: PortainerContainer
  ) => {
    if (action !== "start") {
      const ok = await confirm({
        title: `${action === "stop" ? "Stop" : "Restart"} container`,
        message: `${action === "stop" ? "Stop" : "Restart"} “${c.name}”?`,
        confirmLabel: action === "stop" ? "Stop" : "Restart",
        danger: action === "stop",
      });
      if (!ok) return;
    }
    const done = await run(c.id, {
      service: "portainer",
      action,
      endpoint: endpointId,
      container: c.id,
    });
    // Reflect the new container state in the open list (the snapshot refetch via
    // onActed updates the environment tallies, not this drill-down).
    if (done) loadContainers(endpointId);
  };

  const openLogs = async (endpointId: number, c: PortainerContainer) => {
    setLogTarget(c);
    setLogs("");
    setLogError(null);
    setLogLoading(true);
    const res = await fetchContainerLogs(endpointId, c.id);
    setLogLoading(false);
    if (res.error) setLogError(res.error);
    else setLogs(res.logs ?? "");
  };

  return (
    <MonitorCard title="Portainer" status={status}>
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-fg/90">
              {data.totals.running}
              <span className="ml-1.5 text-xs font-normal text-fg/50">
                running
              </span>
            </span>
            <span className="text-xs text-fg/50">
              {data.totals.stopped} stopped
              {data.totals.unhealthy > 0 && (
                <span className="text-red-400">
                  {" "}
                  · {data.totals.unhealthy} unhealthy
                </span>
              )}{" "}
              · {data.totals.total} total
            </span>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {data.endpoints.length > 0 ? (
            <ul className="flex flex-col gap-1.5 border-t border-fg/10 pt-3">
              {data.endpoints.map((e, i) => {
                // Only Docker environments (with a snapshot) and a real id can
                // be drilled into; others stay read-only rows.
                const expandable =
                  status.actionsAllowed && e.hasSnapshot && e.id > 0;
                const isOpen = expanded === e.id;
                return (
                  <EndpointRow
                    key={`${e.id}-${e.name}-${i}`}
                    endpoint={e}
                    expandable={expandable}
                    expanded={isOpen}
                    onToggle={() => toggle(e.id)}
                  >
                    {expandable && isOpen && (
                      <div className="ml-2 border-l border-fg/10 pl-3">
                        {loadingList ? (
                          <p className="py-2 text-xs text-fg/50">Loading…</p>
                        ) : listError ? (
                          <p className="py-2 text-xs text-red-400">{listError}</p>
                        ) : containers.length > 0 ? (
                          <ul className="divide-y divide-fg/10">
                            {containers.map((c) => (
                              <ContainerRow
                                key={c.id}
                                container={c}
                                busy={busy === c.id}
                                onAction={(action, cc) => onAction(e.id, action, cc)}
                                onLogs={(cc) => openLogs(e.id, cc)}
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="py-2 text-xs text-fg/40">No containers.</p>
                        )}
                      </div>
                    )}
                  </EndpointRow>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">No environments.</p>
          )}
        </>
      )}
      {logTarget && (
        <LogModal
          name={logTarget.name}
          logs={logs}
          loading={logLoading}
          error={logError}
          onClose={() => setLogTarget(null)}
        />
      )}
    </MonitorCard>
  );
}
