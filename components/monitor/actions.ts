"use client";

import { useCallback, useState } from "react";
import type { PortainerContainer } from "@/lib/services/portainer";

// Client helper for the Monitor cards' write actions (#201/#202/#203): POST the
// action to the admin-gated /api/monitor/action dispatcher and surface the
// result. The body union mirrors the route's zod schema; each service adds its
// own variant as its actions ship.

export type MonitorActionBody =
  | {
      service: "qbittorrent";
      action: "pause" | "resume" | "delete";
      hash: string;
      deleteFiles?: boolean;
    }
  | {
      service: "seerr";
      action: "approve" | "decline";
      id: number;
    }
  | {
      service: "portainer";
      action: "start" | "stop" | "restart";
      endpoint: number;
      container: string;
    };

export type ActionResult = { ok: boolean; error?: string };

export async function runMonitorAction(
  body: MonitorActionBody
): Promise<ActionResult> {
  try {
    const res = await fetch("/api/monitor/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// Portainer's on-demand reads (#203): one environment's container list, and a
// container's log tail. GETs to the admin-gated drill-down routes; the card
// calls them only when the admin expands an environment or opens the logs.
export async function fetchContainers(
  endpoint: number
): Promise<{ containers?: PortainerContainer[]; error?: string }> {
  try {
    const res = await fetch(
      `/api/monitor/portainer/containers?endpoint=${endpoint}`
    );
    const data = (await res.json().catch(() => ({}))) as {
      containers?: PortainerContainer[];
      error?: string;
    };
    if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
    return { containers: data.containers ?? [] };
  } catch {
    return { error: "Network error" };
  }
}

export async function fetchContainerLogs(
  endpoint: number,
  container: string
): Promise<{ logs?: string; error?: string }> {
  try {
    const res = await fetch(
      `/api/monitor/portainer/logs?endpoint=${endpoint}&container=${encodeURIComponent(container)}`
    );
    const data = (await res.json().catch(() => ({}))) as {
      logs?: string;
      error?: string;
    };
    if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
    return { logs: data.logs ?? "" };
  } catch {
    return { error: "Network error" };
  }
}

// Per-card action state: which control is mid-flight (`busy`, an opaque key the
// card picks — a torrent hash, a request id, …), the latest failure, and a
// `run` that fires one action, disables its control, and calls `onActed` (a
// snapshot refetch) on success so the card reflects the change promptly rather
// than waiting for the next poll.
export function useMonitorAction(onActed?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, body: MonitorActionBody): Promise<boolean> => {
      setBusy(key);
      setError(null);
      const res = await runMonitorAction(body);
      setBusy(null);
      if (res.ok) onActed?.();
      else setError(res.error ?? "Action failed");
      return res.ok;
    },
    [onActed]
  );

  return { busy, error, run };
}
