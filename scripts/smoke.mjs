// Browser smoke test of the production build, run in CI after `npm run build`
// (and locally via `npm run smoke`). Assembles the standalone output the way
// the Dockerfile does, serves it against a scratch copy of the example config,
// and renders the key pages in headless Chromium — failing on broken assets,
// same-origin errors, page errors, a missing stylesheet, or a WCAG 2.1 AA
// violation (axe-core, in both color schemes). Then signs in through the real
// login form and renders the admin pages. Last, it turns status checks on
// against local targets — one up, one down, one with a certificate warning —
// and renders the status surfaces in each state (#311).
//
// Screenshots land in $SMOKE_OUT (default smoke-screenshots/) for upload as a
// CI artifact. Needs a Chromium for playwright-core: `npx playwright-core
// install chromium`, or CHROMIUM_PATH pointing at one.
import { execFileSync, spawn } from "node:child_process";
import tls from "node:tls";
import * as YAML from "js-yaml";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { launchBrowser, checkPage } from "./page-check.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const OUT = path.resolve(process.env.SMOKE_OUT || path.join(ROOT, "smoke-screenshots"));
const PASSWORD = "smoke-test-password";

if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
  console.error("No standalone build — run `npm run build` first.");
  process.exit(2);
}

// Same assembly as the Dockerfile's runner stage (cp into an existing dir
// would nest static/static, hence the rm first).
for (const [from, to] of [
  [path.join(ROOT, ".next", "static"), path.join(STANDALONE, ".next", "static")],
  [path.join(ROOT, "public"), path.join(STANDALONE, "public")],
]) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}
// And the image's entry point beside server.js, so the smoke run serves
// through the same wrapper production does.
fs.copyFileSync(
  path.join(ROOT, "scripts", "server-entry.mjs"),
  path.join(STANDALONE, "server-entry.mjs")
);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrlcenter-smoke-"));
const configPath = path.join(dataDir, "config.yaml");
fs.copyFileSync(path.join(ROOT, "config", "config.example.yaml"), configPath);
fs.mkdirSync(OUT, { recursive: true });

const port = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, "127.0.0.1", () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;

const logPath = path.join(dataDir, "server.log");
const log = fs.openSync(logPath, "w");
const server = spawn(process.execPath, [path.join(STANDALONE, "server-entry.mjs")], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    CONFIG_PATH: configPath,
    ADMIN_PASSWORD: PASSWORD,
  },
  stdio: ["ignore", log, log],
});

const failures = [];
// The smoke integrations' URL (set by addBoards): it must never reach a
// signed-out page.
let integrationUrl = "";
let browser;
// The status phase's local TLS target (see startTlsServer).
let tlsServer;
try {
  // Wait for /api/health.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    if (server.exitCode !== null || Date.now() > deadline) {
      throw new Error("server never became healthy");
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  browser = await launchBrowser();
  const run = async (context, pathname, shot) => {
    const result = await checkPage(context, base + pathname, {
      screenshot: path.join(OUT, `${shot}.png`),
      axe: true,
    });
    for (const w of result.warnings) console.log(`WARN  ${pathname}: ${w}`);
    for (const f of result.failures) failures.push(`${pathname}: ${f}`);
    console.log(`${result.failures.length ? "FAIL" : "ok  "}  ${pathname} (${shot})`);
    return result;
  };

  await addBoards();

  // Public pages, signed out.
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    const pages = ["/", "/b/media", "/status", "/weather", "/calendar", "/help", "/settings", "/admin/login"];
    for (const p of pages) {
      await run(ctx, p, `${p === "/" ? "home" : p.slice(1).replace(/\//g, "-")}-${scheme}`);
    }
    // Admin pages bounce a signed-out visitor to the login form, and a
    // private board is a plain 404 (#298).
    if (scheme === "light") {
      const media = await (await fetch(`${base}/b/media`)).text();
      if (!media.includes("Sonarr 4K")) failures.push("/b/media: the public integration tile is missing");
      if (integrationUrl && media.includes(integrationUrl.replace("http://", "")))
        failures.push("/b/media: an integration URL reached a signed-out page");
      else console.log("ok    /b/media shows the public tile and no integration URL");
      const res = await fetch(`${base}/b/infra`);
      if (res.status !== 404) failures.push(`/b/infra: signed-out visitor got HTTP ${res.status}, not 404`);
      else console.log("ok    /b/infra is a 404 signed out");
      const r = await run(ctx, "/admin", "admin-signed-out");
      if (!new URL(r.finalUrl).pathname.startsWith("/admin/login")) {
        failures.push(`/admin: signed-out visitor landed on ${r.finalUrl}, not the login page`);
      }
    }
    await ctx.close();
  }

  // Sign in through the real form, then render the admin pages — in both
  // schemes, since contrast regressions tend to be scheme-specific.
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    await signIn(ctx);
    console.log(`ok    signed in through /admin/login (${scheme})`);
    for (const [p, shot] of [
      ["/admin", "admin"],
      ["/admin?tab=bookmarks", "admin-bookmarks"],
      ["/admin?tab=settings", "admin-settings"],
      ["/admin?tab=settings&section=widgets", "admin-widgets"],
      ["/admin?tab=settings&section=layout", "admin-layout"],
      ["/admin?tab=settings&section=integrations", "admin-integrations"],
      ["/admin/monitor/sonarr-4k", "monitor-detail"],
      ["/b/infra", "board-private"],
      ["/admin/monitor", "admin-monitor"],
    ]) {
      await run(ctx, p, `${shot}-${scheme}`);
    }
    await ctx.close();
  }

  await statusPhase(run);
} catch (e) {
  failures.push(`smoke run aborted: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser?.close();
  server.kill();
  tlsServer?.close();
}

// The status surfaces (#311): the example config has checks off (they'd reach
// the example apps' real hosts), so switch them on against local targets
// only, wait for each state to show up, and render where it surfaces, plus
// the monitoring settings with alerts set up.
async function statusPhase(run) {
  const closedPort = await freePort();
  const apps = [
    {
      id: "smoke-up",
      name: "Smoke Up",
      url: `${base}/api/health`,
      checkType: "json",
      jsonQuery: '$.status == "ok"',
    },
    { id: "smoke-down", name: "Smoke Down", url: `http://127.0.0.1:${closedPort}/`, checkType: "tcp" },
    // Down too, but inside a maintenance window (#293).
    { id: "smoke-maint", name: "Smoke Maint", url: `http://127.0.0.1:${closedPort}/`, checkType: "tcp" },
  ];
  const tlsPort = await startTlsServer();
  if (tlsPort) {
    apps.push({
      id: "smoke-warn",
      name: "Smoke Cert",
      url: `https://localhost:${tlsPort}/`,
      checkType: "tls",
    });
  } else {
    console.log("skip  certificate warning state (no openssl to mint a test certificate)");
  }
  const config = YAML.load(fs.readFileSync(configPath, "utf8"));
  config.settings.statusChecks = true;
  config.apps = [...config.apps.map((a) => ({ ...a, monitor: false })), ...apps];
  config.settings.statusAnnouncements = [
    {
      id: "smoke-window",
      kind: "maintenance",
      title: "Smoke maintenance",
      body: "Planned work on **Smoke Maint**.",
      apps: ["smoke-maint"],
    },
  ];
  // Alerts with every part of their settings card on show (#291), none able
  // to send: the original webhook and one channel are switched off, the
  // other channel is missing its chat ID.
  config.settings.alerts = {
    ...config.settings.alerts,
    enabled: true,
    webhookUrl: `http://127.0.0.1:${closedPort}/`,
    webhookEnabled: false,
    channels: [
      { id: "smoke-webhook", type: "webhook", enabled: false, url: `http://127.0.0.1:${closedPort}/` },
      { id: "smoke-telegram", type: "telegram", name: "Phone", token: "smoke", apps: ["smoke-down"] },
    ],
  };
  fs.writeFileSync(configPath, YAML.dump(config));

  // Each state as /api/status reports it.
  const expected = {
    "smoke-up": "up",
    "smoke-down": "down",
    "smoke-maint": "maintenance",
    "smoke-warn": "warning",
  };
  const deadline = Date.now() + 30_000;
  for (;;) {
    const { results } = await (await fetch(`${base}/api/status`)).json();
    const seen = Object.fromEntries(
      results.map((r) => [
        r.id,
        r.up ? (r.warning ? "warning" : "up") : r.maintenance ? "maintenance" : "down",
      ])
    );
    const pending = apps.filter((a) => seen[a.id] !== expected[a.id]);
    if (pending.length === 0) break;
    if (Date.now() > deadline) {
      failures.push(
        `status states never settled: ${pending.map((a) => `${a.id}=${seen[a.id] ?? "none"}`).join(", ")}`
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`ok    status states: ${apps.map((a) => `${a.id}=${expected[a.id]}`).join(", ")}`);

  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    for (const [p, shot] of [
      ["/", "status-home"],
      ["/status", "status-states"],
      ...apps.map((a) => [`/status/${a.id}`, `status-${a.id}`]),
    ]) {
      await run(ctx, p, `${shot}-${scheme}`);
    }
    await signIn(ctx);
    await run(ctx, "/admin?tab=settings&section=monitoring", `admin-monitoring-${scheme}`);
    await ctx.close();
  }
}

// Two boards beside the example's home board (#298): a public one, and a
// private one only the admin can open. Then two integrations of one type. Saved through the admin API, the way
// Settings → Layout saves them; the home board keeps its stored rows.
async function addBoards() {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const res = await ctx.request.put(`${base}/api/boards`, {
    headers: { Origin: base },
    data: [
      { id: "home", name: "Home", visibility: "public" },
      {
        id: "media",
        name: "Media",
        visibility: "public",
        layout: { sections: [{ widget: "search" }, { widget: "bookmarks" }] },
      },
      { id: "infra", name: "Infra", visibility: "private", layout: { sections: [{ widget: "apps" }] } },
    ],
  });
  if (!res.ok()) throw new Error(`adding boards failed: HTTP ${res.status()}`);
  // Two of one integration type (#300), pointed at a closed local port so the
  // Monitor renders their offline tiles without reaching anything real.
  const dead = `http://127.0.0.1:${await freePort()}`;
  integrationUrl = dead;
  const ints = await ctx.request.put(`${base}/api/integrations`, {
    headers: { Origin: base },
    data: [
      { id: "sonarr", type: "sonarr", name: "", enabled: true, url: dead, username: "", password: "", apiKey: "k", allowInsecureTls: false, allowActions: false },
      { id: "sonarr-4k", type: "sonarr", name: "Sonarr 4K", enabled: true, url: dead, username: "", password: "", apiKey: "${SMOKE_KEY}", allowInsecureTls: false, allowActions: false },
    ],
  });
  if (!ints.ok()) throw new Error(`adding integrations failed: HTTP ${ints.status()}`);
  // A public integration tile on the public board (#301): its offline tile,
  // public view, renders for signed-out visitors.
  const config = await (await ctx.request.get(`${base}/api/config`)).json();
  const widgets = await ctx.request.put(`${base}/api/widgets`, {
    headers: { Origin: base },
    data: [...config.widgets, { id: "sonarr-tile", type: "integration", integration: "sonarr-4k", view: "glance", visibility: "public" }],
  });
  if (!widgets.ok()) throw new Error(`adding the integration tile failed: HTTP ${widgets.status()}`);
  const media = await ctx.request.put(`${base}/api/boards/media/layout`, {
    headers: { Origin: base },
    data: { sections: [{ widget: "search" }, { widget: "sonarr-tile", span: 8 }, { widget: "bookmarks" }] },
  });
  if (!media.ok()) throw new Error(`placing the integration tile failed: HTTP ${media.status()}`);
  await ctx.close();
}

async function signIn(ctx) {
  const login = await ctx.newPage();
  await login.goto(`${base}/admin/login`);
  await login.fill('input[type="password"]', PASSWORD);
  await login.keyboard.press("Enter");
  await login.waitForURL((u) => u.pathname === "/admin", { timeout: 15_000 });
  await login.close();
}

// A port nothing listens on (bound then released).
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// A local TLS server whose certificate expires in five days — inside the TLS
// check's default 14-day warning window. Null when openssl isn't available.
async function startTlsServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrlcenter-smoke-tls-"));
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "5", "-subj", "/CN=localhost",
        "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")],
      { stdio: "ignore" }
    );
  } catch {
    return null;
  }
  tlsServer = tls.createServer(
    { key: fs.readFileSync(path.join(dir, "key.pem")), cert: fs.readFileSync(path.join(dir, "cert.pem")) },
    (socket) => socket.end()
  );
  return new Promise((resolve) => tlsServer.listen(0, "127.0.0.1", () => resolve(tlsServer.address().port)));
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n--- server log (${logPath}) ---\n${fs.readFileSync(logPath, "utf8")}`);
  process.exit(1);
}
console.log(`\nSmoke test passed; screenshots in ${path.relative(ROOT, OUT) || OUT}`);
