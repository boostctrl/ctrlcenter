import net from "node:net";
import dns from "node:dns/promises";
import { execFile } from "node:child_process";
import { matchesStatus, type AppStatus } from "./status";
import { readCapped } from "./fetch-body";
import type { AppItem } from "./schema";

const TIMEOUT_MS = 5000;
// Keyword checks read the body; cap what gets buffered so a check pointed at a
// huge response (say, a download URL instead of a landing page) can't spike the
// Node heap on every poll. The keyword is expected in page HTML, so 2 MB is
// plenty.
const KEYWORD_MAX_BYTES = 2 * 1024 * 1024;

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

// HTTP reachability. Keyword-less checks send a cheap HEAD, then fall back to
// GET once when the HEAD misbehaves in any of the ways real servers do: it threw
// with budget left (a dropped/reset connection), answered 405/501 (method not
// implemented), or returned a status outside `expectStatus` (some servers
// 403/400 a HEAD they'd happily serve as GET). An empty `expectStatus` matches
// anything, so a well-behaved server settles on the single HEAD. A reachable
// host is "up" unless `expectStatus` restricts the codes. When `keyword` is set
// we must read the body (always GET) and also require the keyword to appear in
// it — catching "up but broken" pages.
async function checkHttp(app: CheckInput, keyword: string): Promise<AppStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  // Shared across the HEAD and its GET fallback so the whole check stays within
  // one TIMEOUT_MS budget.
  const opts = { redirect: "manual" as const, signal: controller.signal };
  try {
    if (keyword) {
      const res = await fetch(app.url, { method: "GET", ...opts });
      // An over-cap (or unreadable) body reads as null: the keyword couldn't be
      // verified, so treat it like a keyword miss.
      const body = await readCapped(res, KEYWORD_MAX_BYTES);
      const up =
        matchesStatus(res.status, app.expectStatus ?? "") &&
        body !== null &&
        body.toLowerCase().includes(keyword.toLowerCase());
      return { up, status: res.status, ms: Date.now() - start };
    }

    let res: Response | null = null;
    let needGet: boolean;
    try {
      res = await fetch(app.url, { method: "HEAD", ...opts });
      // Retry as GET when HEAD is method-not-implemented (405/501) or its status
      // fails expectStatus. The GET response then supplies up/status, so the
      // displayed code stays honest. Empty expectStatus matches anything, so no
      // fallback fires — same "any response is up" default as before.
      needGet =
        res.status === 405 ||
        res.status === 501 ||
        !matchesStatus(res.status, app.expectStatus ?? "");
    } catch {
      // HEAD threw. If the abort timer fired the budget is spent, so report down
      // without retrying; otherwise it's a dropped/reset connection (some
      // servers hang up on HEAD) and the shared timer still has room for a GET.
      if (controller.signal.aborted) {
        return { up: false, status: null, ms: Date.now() - start };
      }
      needGet = true;
    }

    if (needGet) {
      res = await fetch(app.url, { method: "GET", ...opts });
      // The fallback GET's body is never read; cancel it so the connection is
      // released back to the pool instead of dangling until GC.
      void res.body?.cancel().catch(() => {});
    }

    // res is set here: either HEAD returned, or the fallback GET did (a throwing
    // GET propagates to the outer catch → down).
    return {
      up: matchesStatus(res!.status, app.expectStatus ?? ""),
      status: res!.status,
      ms: Date.now() - start,
    };
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

// A stable, guaranteed-registered name to ask the resolver about: any recursive
// resolver answers it, so the probe measures whether the server is answering
// queries rather than whether one particular record happens to exist.
const DNS_PROBE_NAME = "example.com";

// DNS: treats the app URL's host as the DNS server under test and asks it to
// resolve DNS_PROBE_NAME — the natural "is my Pi-hole answering queries?" check
// (verifying the host's own name resolves would be useless for that).
async function checkDns(app: CheckInput): Promise<AppStatus> {
  const start = Date.now();
  const { host } = hostFromUrl(app.url);
  if (!host) return { up: false, status: null, ms: 0 };
  // URL hostnames bracket IPv6 literals ("[::1]"); strip them so net.isIP
  // recognises the address and we control the host:port bracketing ourselves.
  const bareHost = host.replace(/^\[(.+)\]$/, "$1");

  // The server's address. An IP literal is used directly; a hostname has to be
  // resolved (via the OS resolver) once just to reach the box at all — a failure
  // here means we never found the server, so it's down.
  let address: string;
  try {
    if (net.isIP(bareHost) !== 0) {
      address = bareHost;
    } else {
      const looked = await Promise.race([dns.lookup(bareHost), rejectAfter(TIMEOUT_MS)]);
      address = looked.address;
    }
  } catch {
    return { up: false, status: null, ms: Date.now() - start };
  }

  // DNS listens on 53; the URL's own port is the web UI (e.g. :8080 on Pi-hole),
  // never the resolver, so it must not leak in — take an explicit `port` or 53.
  // Off-53 servers need host:port form, bracketed for IPv6.
  const port = app.port ?? 53;
  const family = net.isIP(address);
  const server =
    port === 53
      ? address
      : family === 6
        ? `[${address}]:${port}`
        : `${address}:${port}`;

  // The query only gets whatever budget the lookup left, so the whole check —
  // like every other check type — stays within one TIMEOUT_MS.
  const remaining = Math.max(1, TIMEOUT_MS - (Date.now() - start));
  const resolver = new dns.Resolver({ timeout: remaining, tries: 1 });
  resolver.setServers([server]);
  try {
    const addrs = await resolver.resolve4(DNS_PROBE_NAME);
    return { up: addrs.length > 0, status: null, ms: Date.now() - start };
  } catch (err) {
    // NXDOMAIN / no-data / refused-recursion are *answers* from a live server
    // (an authoritative-only resolver refuses to recurse), so they prove it's
    // answering queries. Timeouts, ECONNREFUSED, and anything else → down.
    const code = (err as NodeJS.ErrnoException).code;
    const answered =
      code === "ENOTFOUND" || code === "ENODATA" || code === "EREFUSED";
    return { up: answered, status: null, ms: Date.now() - start };
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
