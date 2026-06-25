import net from "node:net";
import dns from "node:dns/promises";
import { execFile } from "node:child_process";
import { matchesStatus, type AppStatus } from "./status";
import type { AppItem } from "./schema";

const TIMEOUT_MS = 5000;

// The fields a check needs. Callers pass a whole AppItem; this narrows to what
// matters so the live /api/status endpoint and the background history poller
// evaluate reachability identically.
type CheckInput = Pick<
  AppItem,
  "url" | "expectStatus" | "checkType" | "port" | "keyword"
>;

// Check one app and decide up/down. Dispatches on `checkType`; every branch
// returns the same { up, status, ms } shape and treats a timeout/error as down.
// `status` carries the HTTP code for http/keyword checks and is null for the
// transport/name/ping checks (which have no HTTP code).
export async function checkApp(app: CheckInput): Promise<AppStatus> {
  switch (app.checkType) {
    case "tcp":
      return checkTcp(app);
    case "dns":
      return checkDns(app);
    case "icmp":
      return checkIcmp(app);
    case "keyword":
      return checkHttp(app, (app.keyword ?? "").trim());
    case "http":
    default:
      return checkHttp(app, "");
  }
}

// HTTP reachability. HEAD avoids downloading bodies; some servers reject it, so
// fall back to GET. A reachable host is "up" unless `expectStatus` restricts the
// codes. When `keyword` is set we must read the body (always GET) and also
// require the keyword to appear in it — catching "up but broken" pages.
async function checkHttp(app: CheckInput, keyword: string): Promise<AppStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const method = keyword ? "GET" : "HEAD";
    let res = await fetch(app.url, {
      method,
      redirect: "manual",
      signal: controller.signal,
    });
    if (!keyword && (res.status === 405 || res.status === 501)) {
      res = await fetch(app.url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
    }
    let up = matchesStatus(res.status, app.expectStatus ?? "");
    if (keyword) {
      const body = await res.text();
      up = up && body.toLowerCase().includes(keyword.toLowerCase());
    }
    return { up, status: res.status, ms: Date.now() - start };
  } catch {
    return { up: false, status: null, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// Host + (optional) explicit port parsed from the app URL.
function hostFromUrl(raw: string): { host: string; urlPort: number | null; https: boolean } {
  try {
    const u = new URL(raw);
    return {
      host: u.hostname,
      urlPort: u.port ? Number(u.port) : null,
      https: u.protocol === "https:",
    };
  } catch {
    return { host: "", urlPort: null, https: false };
  }
}

// TCP connect: up if the socket opens within the timeout. Port precedence:
// the explicit `port` field, else the URL's port, else the scheme default.
function checkTcp(app: CheckInput): Promise<AppStatus> {
  const start = Date.now();
  const { host, urlPort, https } = hostFromUrl(app.url);
  const port = app.port ?? urlPort ?? (https ? 443 : 80);
  return new Promise((resolve) => {
    if (!host) return resolve({ up: false, status: null, ms: 0 });
    const socket = new net.Socket();
    const done = (up: boolean) => {
      socket.destroy();
      resolve({ up, status: null, ms: Date.now() - start });
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms)
  );
}

// DNS: up if the app URL's host resolves to at least one address.
async function checkDns(app: CheckInput): Promise<AppStatus> {
  const start = Date.now();
  const { host } = hostFromUrl(app.url);
  if (!host) return { up: false, status: null, ms: 0 };
  try {
    const addrs = await Promise.race([
      dns.lookup(host, { all: true }),
      rejectAfter(TIMEOUT_MS),
    ]);
    return {
      up: Array.isArray(addrs) && addrs.length > 0,
      status: null,
      ms: Date.now() - start,
    };
  } catch {
    return { up: false, status: null, ms: Date.now() - start };
  }
}

// ICMP: one ping to the app URL's host. Uses the system `ping` binary via
// execFile (args as an array — no shell, and the host is a parsed URL hostname,
// so there's no command-injection surface). NOTE: in a container ICMP needs the
// NET_RAW capability (or a permissive net.ipv4.ping_group_range); without it
// `ping` errors and the app simply reports down rather than crashing.
function checkIcmp(app: CheckInput): Promise<AppStatus> {
  const start = Date.now();
  const { host } = hostFromUrl(app.url);
  return new Promise((resolve) => {
    if (!host) return resolve({ up: false, status: null, ms: 0 });
    const deadline = Math.max(1, Math.ceil(TIMEOUT_MS / 1000));
    execFile(
      "ping",
      ["-c", "1", "-w", String(deadline), host],
      { timeout: TIMEOUT_MS },
      (err) => {
        resolve({ up: !err, status: null, ms: Date.now() - start });
      }
    );
  });
}
