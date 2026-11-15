"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortainerContainer, PortainerDetail as PortainerDetailData, PortainerEndpoint } from "@/lib/services/portainer";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/admin/ui";
import { useConfirm } from "@/components/admin/Confirm";
import { fetchContainerLogs, fetchContainers, useMonitorAction, useMonitorIntegration } from "../actions";
import { Dialog, Donut, Dot, EmptyRow, Glyph, List, Row, GlyphBubble, Pill, Section, Stat, StatGrid, UsageBar, type Tone } from "../kit";

// Portainer's page (#514), on the page kit (#508): container counts across
// every environment, then each environment with its tallies. With actions
// on (#203), an environment opens to its containers, which can be started,
// stopped or restarted (stop and restart confirmed) and their logs read.

function containerTone(state: string): Tone {
  if (state === "running") return "up";
  if (state === "exited" || state === "dead" || state === "created") return "muted";
  return "warn"; // restarting, paused, removing, …
}

// Read-only, scrollable, capped log tail, in the kit's dialog (portaled to
// the body: a card is a glass surface, which would otherwise trap it).
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
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={`Logs — ${name}`}
      wide
      onClose={onClose}
      initialFocus={closeRef}
      actions={
        <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-ink-50">Loading…</p>
      ) : error ? (
        <p className="text-sm text-status-down">{error}</p>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-black/70 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-neutral-200">
          {logs.trim() ? logs : "No log output."}
        </pre>
      )}
    </Dialog>
  );
}

// "12 containers · 31 images · Docker 27.3.1 · 16 CPUs · 64 GB"
function environmentLine(e: PortainerEndpoint, r: PortainerDetailData["resources"][number] | undefined): string {
  return [
    `${e.total} container${e.total === 1 ? "" : "s"}`,
    r?.images ? `${r.images} images` : "",
    r?.dockerVersion ? `Docker ${r.dockerVersion}` : "",
    r?.cpus ? `${r.cpus} CPUs` : "",
    r?.memory ? formatBytes(r.memory) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// An environment's tallies as chips.
function Tallies({ endpoint }: { endpoint: PortainerEndpoint }) {
  if (!endpoint.hasSnapshot) return <Pill>No snapshot</Pill>;
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      <Pill tone="up">{endpoint.running} running</Pill>
      {endpoint.stopped > 0 && <Pill>{endpoint.stopped} stopped</Pill>}
      {endpoint.unhealthy > 0 && <Pill tone="down">{endpoint.unhealthy} unhealthy</Pill>}
    </span>
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
  onAction: (action: "start" | "stop" | "restart", c: PortainerContainer) => void;
  onLogs: (c: PortainerContainer) => void;
}) {
  const running = container.state === "running";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-5 pl-[4.25rem]">
      <Dot tone={containerTone(container.state)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-85" title={container.name}>
          {container.name}
        </p>
        <p className="truncate text-xs text-ink-50">{container.status || container.state}</p>
      </div>
      <span className="flex shrink-0 gap-2">
        {running ? (
          <>
            <Button
              aria-label={`Restart ${container.name}`}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onAction("restart", container)}
            >
              Restart
            </Button>
            <Button
              aria-label={`Stop ${container.name}`}
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => onAction("stop", container)}
            >
              Stop
            </Button>
          </>
        ) : (
          <Button
            aria-label={`Start ${container.name}`}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onAction("start", container)}
          >
            Start
          </Button>
        )}
        <Button aria-label={`Logs for ${container.name}`} variant="ghost" size="sm" onClick={() => onLogs(container)}>
          Logs
        </Button>
      </span>
    </li>
  );
}

export default function PortainerDetail({
  data,
  actionsAllowed,
  onActed,
}: {
  data: PortainerDetailData;
  actionsAllowed: boolean;
  onActed?: () => void;
}) {
  const confirm = useConfirm();
  const { busy, error, run } = useMonitorAction(onActed);
  const integration = useMonitorIntegration();

  const [expanded, setExpanded] = useState<number | null>(null);
  const [containers, setContainers] = useState<PortainerContainer[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [logTarget, setLogTarget] = useState<PortainerContainer | null>(null);
  const [logs, setLogs] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // The environment whose list is on screen, and a counter over list and log
  // loads: a reply lands only while it is still the latest for what's open,
  // so a slow environment's list can't fill another's row (and its buttons
  // act on the wrong environment), nor a slow log another container's
  // modal (#463).
  const shown = useRef<number | null>(null);
  const listSeq = useRef(0);
  const logSeq = useRef(0);

  const loadContainers = useCallback(
    async (endpointId: number) => {
      // An action's reload for an environment closed since doesn't take over.
      if (shown.current !== endpointId) return;
      const seq = ++listSeq.current;
      setLoadingList(true);
      setListError(null);
      const res = await fetchContainers(integration, endpointId);
      if (seq !== listSeq.current || shown.current !== endpointId) return;
      setLoadingList(false);
      if (res.error) setListError(res.error);
      else setContainers(res.containers ?? []);
    },
    [integration]
  );

  // Open the first environment that can open, so the page starts on real
  // containers rather than a column of closed rows (#234). Once only: a later
  // poll or a manual close must stick.
  const autoExpanded = useRef(false);
  useEffect(() => {
    if (autoExpanded.current || !actionsAllowed) return;
    const first = data.endpoints.find((e) => e.hasSnapshot && e.id > 0);
    if (!first) return;
    autoExpanded.current = true;
    const raf = requestAnimationFrame(() => {
      shown.current = first.id;
      setExpanded(first.id);
      loadContainers(first.id);
    });
    return () => cancelAnimationFrame(raf);
  }, [actionsAllowed, data, loadContainers]);

  const toggle = (endpointId: number) => {
    if (expanded === endpointId) {
      shown.current = null;
      listSeq.current++;
      setLoadingList(false);
      setExpanded(null);
      return;
    }
    shown.current = endpointId;
    setExpanded(endpointId);
    setContainers([]);
    loadContainers(endpointId);
  };

  const onAction = async (endpointId: number, action: "start" | "stop" | "restart", c: PortainerContainer) => {
    if (action !== "start") {
      const ok = await confirm({
        title: `${action === "stop" ? "Stop" : "Restart"} container`,
        message: `${action === "stop" ? "Stop" : "Restart"} “${c.name}”?`,
        confirmLabel: action === "stop" ? "Stop" : "Restart",
        danger: action === "stop",
      });
      if (!ok) return;
    }
    const done = await run(c.id, { service: "portainer", action, endpoint: endpointId, container: c.id });
    // The open list shows the new state; the snapshot refetch (onActed)
    // updates the environment tallies.
    if (done) loadContainers(endpointId);
  };

  const openLogs = async (endpointId: number, c: PortainerContainer) => {
    const seq = ++logSeq.current;
    setLogTarget(c);
    setLogs("");
    setLogError(null);
    setLogLoading(true);
    const res = await fetchContainerLogs(integration, endpointId, c.id);
    if (seq !== logSeq.current) return;
    setLogLoading(false);
    if (res.error) setLogError(res.error);
    else setLogs(res.logs ?? "");
  };

  const t = data.totals;
  const noSnapshot = data.endpoints.filter((e) => !e.hasSnapshot).length;
  const resourcesOf = (id: number) => data.resources.find((r) => r.endpointId === id);
  const images = data.resources.reduce((sum, r) => sum + r.images, 0);
  const volumes = data.resources.reduce((sum, r) => sum + r.volumes, 0);
  const activeStacks = data.stacks.filter((st) => st.active).length;
  return (
    <div className="flex flex-col gap-6">
      <StatGrid six>
        <Stat
          label="Running"
          value={t.running}
          hint={`of ${t.total} containers`}
          visual={<UsageBar ratio={t.total ? t.running / t.total : 0} tone="up" />}
        />
        <Stat label="Stopped" value={t.stopped} hint={t.stopped ? "Exited or created" : "None stopped"} />
        <Stat
          label="Unhealthy"
          value={t.unhealthy}
          tone={t.unhealthy > 0 ? "down" : undefined}
          hint={t.unhealthy ? "Failing their health check" : "All health checks pass"}
        />
        <Stat
          label="Environments"
          value={data.endpoints.length}
          hint={noSnapshot ? `${noSnapshot} without a snapshot` : "All reporting"}
        />
        <Stat label="Stacks" value={data.stacks.length} hint={data.stacks.length ? `${activeStacks} active` : "None deployed"} />
        <Stat label="Images" value={images} hint={`${volumes} volume${volumes === 1 ? "" : "s"}`} />
      </StatGrid>

      {t.total > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Section title="Containers" description="Across every environment.">
            <Donut
              label="Containers by state"
              center={String(t.total)}
              caption="containers"
              parts={[
                { label: "Running", value: Math.max(0, t.running - t.unhealthy), color: 3 },
                { label: "Unhealthy", value: t.unhealthy, color: "down" },
                { label: "Stopped", value: t.stopped, color: "muted" },
                // Created, paused or restarting: the rest of the total.
                ...(t.total > t.running + t.stopped
                  ? [{ label: "Other", value: t.total - t.running - t.stopped, color: 4 as const }]
                  : []),
              ]}
            />
          </Section>
          <Section title="Stacks" count={data.stacks.length} flush>
            {data.stacks.length > 0 ? (
              <List>
                {data.stacks.map((st) => (
                  <Row
                    key={`${st.environment}-${st.name}`}
                    leading={<GlyphBubble name="box" tone={st.active ? "muted" : "muted"} />}
                    primary={st.name}
                    title={st.name}
                    secondary={[st.environment, st.kind].filter(Boolean).join(" · ")}
                    trailing={<Pill tone={st.active ? "up" : "muted"}>{st.active ? "Active" : "Inactive"}</Pill>}
                  />
                ))}
              </List>
            ) : (
              <EmptyRow>No stacks, or this key can&apos;t list them.</EmptyRow>
            )}
          </Section>
        </div>
      )}

      <Section
        title="Environments"
        count={data.endpoints.length}
        description={
          error ? (
            <span className="text-status-down">{error}</span>
          ) : actionsAllowed ? (
            "Open an environment to see its containers."
          ) : (
            "Turn on actions for Portainer in Settings to see each environment's containers and start, stop or restart them."
          )
        }
        flush
      >
        {data.endpoints.length > 0 ? (
          <ul className="divide-y divide-fg/[0.07]">
            {data.endpoints.map((e, i) => {
              // Only Docker environments (with a snapshot) and a real id open.
              const expandable = actionsAllowed && e.hasSnapshot && e.id > 0;
              const isOpen = expandable && expanded === e.id;
              const head = (
                <>
                  <GlyphBubble name="server" tone={e.unhealthy > 0 ? "down" : e.hasSnapshot ? "muted" : "muted"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink-85" title={e.name}>
                      {e.name}
                    </p>
                    <p className="truncate text-xs text-ink-50">
                      {e.hasSnapshot ? environmentLine(e, resourcesOf(e.id)) : "Not a Docker environment, or not reporting"}
                    </p>
                  </div>
                  <Tallies endpoint={e} />
                </>
              );
              return (
                <li key={`${e.id}-${e.name}-${i}`}>
                  {expandable ? (
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-fg/[0.03]"
                    >
                      {head}
                      <span className={`shrink-0 text-ink-45 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                        <Glyph name="chevron" />
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-5 py-3">{head}</div>
                  )}
                  {isOpen && (
                    <div className="border-t border-fg/[0.07] bg-fg/[0.02]">
                      {loadingList ? (
                        <p className="py-3 pl-[4.25rem] text-xs text-ink-50">Loading…</p>
                      ) : listError ? (
                        <p className="py-3 pl-[4.25rem] text-xs text-status-down">{listError}</p>
                      ) : containers.length > 0 ? (
                        <ul className="divide-y divide-fg/[0.07]">
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
                        <p className="py-3 pl-[4.25rem] text-xs text-ink-50">No containers.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyRow>No environments.</EmptyRow>
        )}
      </Section>

      {logTarget && (
        <LogModal
          name={logTarget.name}
          logs={logs}
          loading={logLoading}
          error={logError}
          onClose={() => {
            logSeq.current++;
            setLogTarget(null);
          }}
        />
      )}
    </div>
  );
}
