// Server-side collector for the System Stats widget (#153): CPU, memory, and
// disk usage rendered as a home-page card. The hard part is honesty — a
// containerized deployment sees cgroup-scoped numbers while a bare-metal one
// sees the whole machine — so every result carries a `source` label the widget
// shows, and the numbers always describe what the label says:
//
// - "container": cgroup v2 readings (/sys/fs/cgroup) — this container's own
//   CPU time and memory, against its configured limits. The default inside
//   Docker/Podman/Kubernetes, with no extra privileges or mounts.
// - "host": whole-machine readings. Chosen on bare metal (reads /proc
//   directly), or opted into from a container by mounting the host's /proc
//   read-only (default mount point /host/proc, override with
//   CTRLCENTER_HOST_PROC) — see the README's deployment notes.
//
// Reads are cheap local files, but the collector is still time-boxed and
// cached: the home page is force-dynamic and reachable anonymously, so a
// slow or hung read degrades the card — it must never hang the render.

import fs from "fs/promises";
import os from "os";
import { basename } from "path";
import { CONFIG_DIR } from "./config";
import { MAX_STAT_DISKS } from "./schema";
import { log, errorReason } from "./log";

export type SystemStatsSource = "container" | "host";

export type DiskStat = {
  label: string;
  usedBytes: number;
  totalBytes: number;
};

export type SystemStats = {
  // What the CPU/memory numbers describe — shown on the card so a reading is
  // never silently wrong about its scope. Disks are per-path either way.
  source: SystemStatsSource;
  // Overall CPU load, 0–100 across all available cores; null until a second
  // sample exists (or when the platform exposes no counters).
  cpu: { percent: number; cores: number } | null;
  memory: { usedBytes: number; totalBytes: number } | null;
  disks: DiskStat[];
};

// Where a host-mode deployment mounts the host's /proc (read-only).
const HOST_PROC = process.env.CTRLCENTER_HOST_PROC || "/host/proc";
const CGROUP = "/sys/fs/cgroup";

// One fresh collection per CACHE_MS serves any burst of renders; SAMPLE_MS is
// the paired-sample interval used only when no previous CPU counter exists
// (first render of a process); TIMEBOX_MS bounds the whole collection.
const CACHE_MS = 5_000;
const SAMPLE_MS = 180;
const TIMEBOX_MS = 800;

// --- Pure parsers (unit-tested; the collector wires them to real files) ---

// cgroup v2 cpu.max: "<quota> <period>" in usec, or "max <period>" for
// unlimited. Returns the core budget (quota/period), or null when unlimited.
export function parseCpuMax(text: string): number | null {
  const [quota, period] = text.trim().split(/\s+/);
  if (quota === "max") return null;
  const q = Number(quota);
  const p = Number(period);
  return Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0
    ? q / p
    : null;
}

// cgroup v2 cpu.stat: the cumulative "usage_usec <n>" line.
export function parseCpuUsageUsec(text: string): number | null {
  const m = /^usage_usec\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) : null;
}

// cgroup v2 memory.current / memory.max: a byte count, or "max" for no limit.
export function parseBytesOrMax(text: string): number | null {
  const t = text.trim();
  if (t === "max") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// cgroup v2 memory.stat: the "inactive_file <n>" line — reclaimable page
// cache, subtracted from memory.current so the reading matches what `docker
// stats` reports instead of counting cache as pressure.
export function parseInactiveFile(text: string): number | null {
  const m = /^inactive_file\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) : null;
}

// /proc/stat's aggregate "cpu " line → cumulative idle and total jiffies.
// idle includes iowait (both are "not doing work"); total is the sum of all
// columns so the percentage self-normalizes across core counts.
export function parseProcStatCpu(
  text: string
): { idleTicks: number; totalTicks: number } | null {
  const m = /^cpu\s+(.+)$/m.exec(text);
  if (!m) return null;
  const cols = m[1].trim().split(/\s+/).map(Number);
  if (cols.length < 4 || cols.some((n) => !Number.isFinite(n))) return null;
  const idle = cols[3] + (cols[4] ?? 0); // idle + iowait
  const total = cols.reduce((a, b) => a + b, 0);
  return { idleTicks: idle, totalTicks: total };
}

// /proc/meminfo → total and available bytes (the kernel's own estimate of
// what's usable without swapping, so page cache doesn't read as pressure).
export function parseMeminfo(
  text: string
): { totalBytes: number; availableBytes: number } | null {
  const total = /^MemTotal:\s+(\d+)\s*kB/m.exec(text);
  const avail = /^MemAvailable:\s+(\d+)\s*kB/m.exec(text);
  if (!total || !avail) return null;
  return {
    totalBytes: Number(total[1]) * 1024,
    availableBytes: Number(avail[1]) * 1024,
  };
}

// --- Collection ---

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

// The previous CPU counter reading, kept between renders so a percentage can
// be computed as a delta without sleeping on every request. `key` pins the
// sample to its source (cgroup vs a /proc path) so switching modes can't mix
// counters. Held on globalThis: Next bundles lib/* per route entry, so a
// module-level variable would keep a separate sample per route.
type CpuCounter =
  | { kind: "cgroup"; usec: number; at: number }
  | { kind: "proc"; idleTicks: number; totalTicks: number; at: number };

const g = globalThis as unknown as {
  __ctrlcenterSystemStats?: {
    prev: { key: string; counter: CpuCounter } | null;
    cache: { stats: SystemStats | null; disksKey: string; at: number } | null;
  };
};
const state = (g.__ctrlcenterSystemStats ??= { prev: null, cache: null });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

// A usable previous sample: old enough that the delta is meaningful, fresh
// enough that it still describes "now" rather than an average since long ago.
function usablePrev(key: string, now: number): CpuCounter | null {
  const prev = state.prev;
  if (!prev || prev.key !== key) return null;
  const age = now - prev.counter.at;
  return age >= 500 && age <= 5 * 60_000 ? prev.counter : null;
}

async function readCgroupCounter(now: number): Promise<CpuCounter | null> {
  const stat = await readText(`${CGROUP}/cpu.stat`);
  const usec = stat ? parseCpuUsageUsec(stat) : null;
  return usec === null ? null : { kind: "cgroup", usec, at: now };
}

async function readProcCounter(
  base: string,
  now: number
): Promise<CpuCounter | null> {
  const stat = await readText(`${base}/stat`);
  const ticks = stat ? parseProcStatCpu(stat) : null;
  return ticks === null ? null : { kind: "proc", ...ticks, at: now };
}

function cpuPercent(prev: CpuCounter, cur: CpuCounter, cores: number): number | null {
  if (prev.kind === "cgroup" && cur.kind === "cgroup") {
    const elapsedUsec = (cur.at - prev.at) * 1000;
    if (elapsedUsec <= 0) return null;
    return clampPct(((cur.usec - prev.usec) / (elapsedUsec * cores)) * 100);
  }
  if (prev.kind === "proc" && cur.kind === "proc") {
    const dTotal = cur.totalTicks - prev.totalTicks;
    const dIdle = cur.idleTicks - prev.idleTicks;
    if (dTotal <= 0) return null;
    return clampPct(((dTotal - dIdle) / dTotal) * 100);
  }
  return null;
}

// CPU percentage for one source: delta against the previous render's counter
// when one is usable, otherwise a one-off paired sample (~180 ms, once per
// process start). The current counter always replaces the stored one so the
// next render is delta-based.
async function collectCpu(
  key: string,
  read: (now: number) => Promise<CpuCounter | null>,
  cores: number
): Promise<{ percent: number; cores: number } | null> {
  const now = Date.now();
  let cur = await read(now);
  if (cur === null) return null;
  let prev = usablePrev(key, now);
  if (!prev) {
    prev = cur;
    await sleep(SAMPLE_MS);
    cur = await read(Date.now());
    if (cur === null) return null;
  }
  state.prev = { key, counter: cur };
  const percent = cpuPercent(prev, cur, cores);
  return percent === null ? null : { percent, cores };
}

async function collectContainer(): Promise<SystemStats> {
  const [cpuMaxText, memCurrent, memMax, memStat] = await Promise.all([
    readText(`${CGROUP}/cpu.max`),
    readText(`${CGROUP}/memory.current`),
    readText(`${CGROUP}/memory.max`),
    readText(`${CGROUP}/memory.stat`),
  ]);
  // Core budget from the cgroup quota; an unlimited container is measured
  // against every core the host shows it (that's what it may actually use).
  const cores = (cpuMaxText ? parseCpuMax(cpuMaxText) : null) ?? os.cpus().length;
  const cpu = await collectCpu("cgroup", readCgroupCounter, cores);

  const current = memCurrent ? parseBytesOrMax(memCurrent) : null;
  const inactive = memStat ? parseInactiveFile(memStat) : null;
  // Unlimited memory (max = "max") is measured against the host's total —
  // that's the real ceiling the container can hit.
  const limit = (memMax ? parseBytesOrMax(memMax) : null) ?? os.totalmem();
  const memory =
    current === null
      ? null
      : {
          usedBytes: Math.max(0, current - (inactive ?? 0)),
          totalBytes: limit,
        };
  return { source: "container", cpu, memory, disks: [] };
}

async function collectProc(base: string): Promise<SystemStats> {
  const cpu = await collectCpu(
    `proc:${base}`,
    (now) => readProcCounter(base, now),
    os.cpus().length
  );
  const meminfoText = await readText(`${base}/meminfo`);
  const meminfo = meminfoText ? parseMeminfo(meminfoText) : null;
  const memory = meminfo
    ? {
        usedBytes: meminfo.totalBytes - meminfo.availableBytes,
        totalBytes: meminfo.totalBytes,
      }
    : null;
  return { source: "host", cpu, memory, disks: [] };
}

// A disk row's public-facing label. The System Stats card renders on the
// anonymous home page, so a blank label must never fall through to the raw
// mount path — that would hand signed-out visitors an internal filesystem-layout
// detail (#184). Fall back to the path's last segment ("/mnt/nas/media" →
// "media"), or a generic "Disk" when even that is empty (e.g. the root "/").
export function diskLabel(label: string, mountPath: string): string {
  const trimmed = label.trim();
  if (trimmed !== "") return trimmed;
  const base = basename(mountPath.trim());
  return base !== "" ? base : "Disk";
}

async function collectDisks(
  extra: { label: string; path: string }[]
): Promise<DiskStat[]> {
  // The data volume first (it's where this app's own state lives), then the
  // admin's explicit mount rows. A path has to be mounted into this
  // container's namespace to be measurable — that's documented on /help.
  const rows = [
    { label: "Data", path: CONFIG_DIR },
    ...extra
      .map((d) => ({ label: d.label.trim(), path: d.path.trim() }))
      .filter((d) => d.path !== "")
      .slice(0, MAX_STAT_DISKS),
  ];
  const out: DiskStat[] = [];
  for (const row of rows) {
    try {
      const s = await fs.statfs(row.path);
      // Only the label reaches the client — the raw path is never serialized,
      // so it can't leak through the props even for a well-labelled row.
      out.push({
        label: diskLabel(row.label, row.path),
        usedBytes: (s.blocks - s.bfree) * s.bsize,
        totalBytes: s.blocks * s.bsize,
      });
    } catch {
      // Not mounted / typo'd path: skip the row rather than fail the card.
    }
  }
  return out;
}

async function collect(
  extraDisks: { label: string; path: string }[]
): Promise<SystemStats> {
  // Source detection, most-specific first:
  // 1. Host /proc mounted in (opt-in host mode from a container).
  // 2. cgroup v2 files present — memory.max only exists in a NON-root cgroup,
  //    which is what distinguishes a container from bare metal (where
  //    /sys/fs/cgroup is the root cgroup and carries no limits files).
  // 3. Bare metal: read /proc directly — the numbers genuinely are the host.
  const [hostStat, memMax] = await Promise.all([
    readText(`${HOST_PROC}/stat`),
    readText(`${CGROUP}/memory.max`),
  ]);
  const base = hostStat !== null ? await collectProc(HOST_PROC)
    : memMax !== null ? await collectContainer()
    : await collectProc("/proc");
  return { ...base, disks: await collectDisks(extraDisks) };
}

// Collect the stats for one render, cached for CACHE_MS and time-boxed to
// TIMEBOX_MS. Returns null when collection failed or timed out — the widget's
// cell degrades; the page renders regardless.
export async function collectSystemStats(
  extraDisks: { label: string; path: string }[]
): Promise<SystemStats | null> {
  const disksKey = JSON.stringify(extraDisks);
  const cached = state.cache;
  if (cached && cached.disksKey === disksKey && Date.now() - cached.at < CACHE_MS) {
    return cached.stats;
  }
  let stats: SystemStats | null = null;
  try {
    stats = await Promise.race([
      collect(extraDisks),
      sleep(TIMEBOX_MS).then(() => null),
    ]);
  } catch (e) {
    log.warn("system stats collection failed", { reason: errorReason(e) });
  }
  state.cache = { stats, disksKey, at: Date.now() };
  return stats;
}
