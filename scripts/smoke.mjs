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
//
// With SMOKE_BROWSER=webkit (`npm run smoke:webkit`, its own CI job) it
// launches Playwright's WebKit instead — Safari's engine, `npx playwright-core
// install webkit` or WEBKIT_PATH — and runs only the sized-cell keyboard
// contract (#355) and clip-box geometry (#354) on the seeded board, the one
// place the engines differ (#430); see webkitSizedCells.
import { execFileSync, spawn } from "node:child_process";
import tls from "node:tls";
import * as YAML from "js-yaml";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { launchBrowser, checkPage, axeScript } from "./page-check.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const OUT = path.resolve(process.env.SMOKE_OUT || path.join(ROOT, "smoke-screenshots"));
const PASSWORD = "smoke-test-password";
const BROWSER = process.env.SMOKE_BROWSER || "chromium";
if (BROWSER !== "chromium" && BROWSER !== "webkit") {
  console.error(`SMOKE_BROWSER=${BROWSER}: use chromium (the default) or webkit.`);
  process.exit(2);
}

if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
  console.error("No standalone build — run `npm run build` first.");
  process.exit(2);
}

// The standalone output must hold only the server and what it traced (#404):
// a computed file path once made Turbopack trace the whole project into it
// (app/, lib/, docs, a dev config/), which the Docker image then shipped.
// Caught by eye that time; caught here from now on.
const STANDALONE_ALLOWED = new Set(["server.js", "package.json", "node_modules", ".next", "public", "server-entry.mjs"]);
const stray = fs.readdirSync(STANDALONE).filter((name) => !STANDALONE_ALLOWED.has(name));
if (stray.length > 0) {
  console.error(
    `The standalone build holds more than the server: ${stray.join(", ")}. A dynamic file path ` +
      "made the build trace the whole project; mark it /* turbopackIgnore: true */ (see lib/config/store.ts)."
  );
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

  browser = await launchBrowser(BROWSER);
  if (BROWSER === "webkit") console.log(`ok    WebKit ${browser.version()}`);
  const run = async (context, pathname, shot, before) => {
    const result = await checkPage(context, base + pathname, {
      screenshot: path.join(OUT, `${shot}.png`),
      axe: true,
      before,
    });
    for (const w of result.warnings) console.log(`WARN  ${pathname}: ${w}`);
    for (const f of result.failures) failures.push(`${pathname}: ${f}`);
    console.log(`${result.failures.length ? "FAIL" : "ok  "}  ${pathname} (${shot})`);
    return result;
  };

  await addBoards();
  if (BROWSER === "webkit") await webkitSizedCells();
  else await chromiumPhases(run);
} catch (e) {
  failures.push(`smoke run aborted: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser?.close();
  server.kill();
  tlsServer?.close();
}

// The Chromium run: the public pages signed out, every built-in look, the
// admin pages and editor flows signed in, then the status, setup and upgrade
// phases — each page audited with axe.
async function chromiumPhases(run) {
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
      if (!media.includes("App health")) failures.push("/b/media: the public API widget is missing");
      else if (media.includes("/api/health")) failures.push("/b/media: an API widget URL reached a signed-out page");
      else console.log("ok    /b/media shows the public API widget and not its URL");
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

  await themeMatrixPhase(run);

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
      ["/?edit=1", "editor"],
    ]) {
      await run(ctx, p, `${shot}-${scheme}`);
    }
    // The editor with a card selected (#313): its floating toolbar and
    // handles, audited too.
    await run(ctx, "/?edit=1", `editor-selected-${scheme}`, async (page) => {
      await page.locator("[data-widget-id]").nth(1).click();
      await page.getByRole("toolbar", { name: /controls$/ }).waitFor({ timeout: 5_000 });
    });
    // A widget's settings open beside the page (#303), straight from the
    // Settings → Widgets "Edit in place" link; and the add-widget palette.
    await run(ctx, "/?edit=1&configure=apps", `editor-panel-${scheme}`, async (page) => {
      await page.locator("[data-widget-panel]").getByText("Card title").waitFor({ timeout: 10_000 });
    });
    await run(ctx, "/?edit=1", `editor-palette-${scheme}`, async (page) => {
      await page.getByRole("button", { name: "Add widget" }).click();
      await page.getByRole("dialog", { name: "Add a widget" }).waitFor({ timeout: 5_000 });
    });
    // Removing a widget and changing or deleting a board from the editor
    // (#318): the panel's Remove confirmation and the open board menu, left
    // unconfirmed.
    await run(ctx, "/?edit=1&configure=apps", `editor-remove-${scheme}`, async (page) => {
      await page.locator("[data-widget-panel]").getByRole("button", { name: "Remove widget" }).click();
      await page.getByRole("alertdialog").waitFor({ timeout: 5_000 });
    });
    await run(ctx, "/?edit=1", `editor-boards-${scheme}`, async (page) => {
      await page.getByRole("button", { name: /^Board:/ }).click();
      const menu = page.getByRole("dialog", { name: "Boards" });
      await menu.getByLabel("Who can open this board").waitFor({ timeout: 5_000 });
      await menu.getByRole("button", { name: "Delete this board" }).waitFor({ timeout: 5_000 });
    });
    if (scheme === "light") {
      await apiWidgetTest(ctx);
      await editorTray(ctx);
      await editorScroll(ctx);
      await sizedCells(ctx);
    }
    await ctx.close();
  }

  await statusPhase(run);
  await setupPhase(run);
  await upgradePhase(run);
}

// Every built-in theme and palette, in both schemes, on the home page (#322):
// the axe audit otherwise only ever sees the default colors, so a look whose
// secondary text or accent button fell under 4.5:1 shipped unseen. Each look
// is applied the way a visitor's choice is — through localStorage, read by the
// no-flash script — which also proves that script runs in the production
// build: it marks <html data-theme-boot>, and a serialization slip in
// lib/theme-paint.ts would otherwise die silently in its try/catch (#325).
// A pack's wallpaper and font are seeded the way applying the pack stores
// them, so a bundled background is fetched and audited and a pack's font is
// the one on the page (#348). Then every scene no pack showcases is rendered
// once, and every canvas scene runs once at full motion, since the matrix
// stills everything and the animation loops would otherwise never run in CI.
// lib/theme.ts imports nothing, so Node loads it as-is (type stripping).
async function themeMatrixPhase(run) {
  const { THEME_PACKS, BASE_THEMES, SCENES } = await import("../lib/theme.ts");
  const looks = [
    ...THEME_PACKS.map((p) => ({ ...p, kind: "theme" })),
    ...BASE_THEMES.map((p) => ({ ...p, design: "glass", scene: "aurora", kind: "palette" })),
  ];
  // One look on the home page, stored as a visitor's choice of it would be.
  const render = async (look, scheme, shot, { motion = "reduce", before } = {}) => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: scheme,
      reducedMotion: motion,
    });
    const entries = {
      "ctrlcenter:theme": scheme,
      "ctrlcenter:activeTheme": JSON.stringify({ dark: look.dark, light: look.light }),
      "ctrlcenter:design": JSON.stringify({ dark: look.design, light: look.designLight ?? look.design }),
      "ctrlcenter:scene": JSON.stringify({ dark: look.scene, light: look.sceneLight ?? look.scene }),
    };
    if (look.wallpaper || look.wallpaperLight) {
      entries["ctrlcenter:wallpaper"] = JSON.stringify({
        dark: look.wallpaper ?? null,
        light: look.wallpaperLight ?? look.wallpaper ?? null,
      });
    }
    if (look.font) entries["ctrlcenter:font"] = JSON.stringify({ dark: look.font, light: look.font });
    await ctx.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, entries);
    let booted = false;
    await run(ctx, "/", shot, async (page) => {
      if (before) await before(page);
      booted = await page.evaluate(
        () => document.documentElement.getAttribute("data-theme-boot") === "1"
      );
    });
    if (!booted) failures.push(`/ (${shot}): the no-flash theme script didn't run`);
    await ctx.close();
  };

  for (const look of looks) {
    const slug = look.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (const scheme of ["dark", "light"]) {
      await render(look, scheme, `${look.kind}-${slug}-${scheme}`);
    }
  }
  console.log(`ok    ${looks.length} built-in looks audited in both schemes`);

  // The scenes no theme showcases, once each on the stock look (dark), so a
  // scene that throws in its effect or breaks the page is seen by CI.
  const shown = new Set(THEME_PACKS.flatMap((p) => [p.scene, p.sceneLight ?? p.scene]));
  const unshown = SCENES.filter((s) => !shown.has(s.id));
  for (const s of unshown) {
    await render({ ...THEME_PACKS[0], scene: s.id }, "dark", `scene-${s.id}-dark`);
  }
  console.log(`ok    ${unshown.length} scenes no theme uses rendered`);

  // Every canvas scene at full motion on the stock look, each left to draw
  // for a moment, so a throw inside its requestAnimationFrame loop surfaces
  // as a page error — the renders above still every scene, so this is the
  // only place those loops run in CI. The list comes from the components
  // themselves: every scene file that calls requestAnimationFrame, named
  // after its id, so a new canvas scene is covered without being listed
  // anywhere (about two seconds each).
  const scenesDir = path.join(ROOT, "components", "scenes");
  const canvas = fs
    .readdirSync(scenesDir)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => fs.readFileSync(path.join(scenesDir, f), "utf8").includes("requestAnimationFrame"))
    .map((f) => ({ file: f, id: f.slice(0, -".tsx".length).toLowerCase() }));
  const ids = new Set(SCENES.map((s) => s.id));
  let moved = 0;
  for (const { file, id } of canvas) {
    if (!ids.has(id)) {
      failures.push(`components/scenes/${file}: calls requestAnimationFrame but is not named after a scene id, so its loop can't be rendered at full motion`);
      continue;
    }
    await render({ ...THEME_PACKS[0], scene: id }, "dark", `motion-${id}-dark`, {
      motion: "no-preference",
      before: (page) => page.waitForTimeout(400),
    });
    moved++;
  }
  if (moved === 0) failures.push("no canvas scene was rendered at full motion");
  console.log(`ok    ${moved} canvas scenes rendered at full motion`);
}

// The first-run setup (#304): with a fresh install's config swapped in, /admin
// leads to the setup (audited), and skipping it lands on the admin page for
// good. Signed in first, while the config still has apps.
async function setupPhase(run) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(ctx);
  fs.writeFileSync(configPath, "schemaVersion: 3\n", "utf8");
  await run(ctx, "/admin", "setup", async (page) => {
    await page.getByRole("heading", { name: "Set up CtrlCenter" }).waitFor({ timeout: 10_000 });
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/admin`);
    await page.getByRole("button", { name: "Skip setup" }).click();
    await page.waitForURL((u) => u.pathname === "/admin", { timeout: 10_000 });
    await page.goto(`${base}/admin`);
    if (new URL(page.url()).pathname !== "/admin") throw new Error("the setup showed again after Skip");
    console.log("ok    a fresh install starts with the setup, and Skip ends it for good");
  } catch (e) {
    failures.push(`setup: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await page.close();
    await ctx.close();
  }
}

// The 2.x → 3.0 upgrade (#306): swap a 2.13 config in under the running
// server, as if a 2.13 install had just started 3.0. The first read migrates
// it: the pages render from the upgraded file, the 2.x file is kept as
// config.v2.bak.yaml, the file on disk is stamped 3, and the admin sees the
// upgrade banner (audited too).
async function upgradePhase(run) {
  // Without its own (fake) admin credential, so ADMIN_PASSWORD still signs in.
  const fixture = fs
    .readFileSync(path.join(ROOT, "lib", "__fixtures__", "config-2.13.yaml"), "utf8")
    .replace(/^auth:\n(?:[ \t].*\n?)*/m, "");
  fs.writeFileSync(configPath, fixture, "utf8");
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await run(guest, "/", "upgraded-home");
  await guest.close();
  const backup = path.join(dataDir, "config.v2.bak.yaml");
  if (!fs.existsSync(backup) || fs.readFileSync(backup, "utf8") !== fixture)
    failures.push("upgrade: config.v2.bak.yaml is missing or isn't the 2.x file");
  const upgraded = YAML.load(fs.readFileSync(configPath, "utf8"));
  if (upgraded?.schemaVersion !== 3 || !Array.isArray(upgraded.boards) || !Array.isArray(upgraded.widgets))
    failures.push("upgrade: config.yaml wasn't saved in the 3.0 shape");
  else console.log("ok    a 2.13 config upgraded on first read, with its backup");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(ctx);
  const r = await run(ctx, "/admin", "upgraded-admin", async (page) => {
    await page.getByRole("heading", { name: "Welcome to CtrlCenter 3.0" }).waitFor({ timeout: 5_000 });
  });
  if (!r.failures.length) console.log("ok    /admin shows the upgrade banner");
  await ctx.close();
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
  // to send: one channel is switched off, the other is missing its chat ID.
  config.settings.alerts = {
    ...config.settings.alerts,
    enabled: true,
    channels: [
      { id: "smoke-webhook", type: "webhook", enabled: false, url: `http://127.0.0.1:${closedPort}/` },
      { id: "smoke-telegram", type: "telegram", name: "Phone", token: "smoke", apps: ["smoke-down"] },
    ],
  };
  // Inbound webhooks with a service on, so the card shows its report
  // options and the open email preview (#347) for the audit in both schemes.
  config.settings.webhooks = { enabled: true, sonarr: { enabled: true, token: "smoke" } };
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
        // A board icon in the menus (#316).
        icon: "jellyfin",
        layout: { sections: [{ widget: "search" }, { widget: "bookmarks" }] },
      },
      { id: "infra", name: "Infra", visibility: "private", layout: { sections: [{ widget: "apps" }] } },
    ],
  });
  if (!res.ok()) throw new Error(`adding boards failed: HTTP ${res.status()}`);
  // Group icons and colors (#316) on the example's bookmark groups, so their
  // headings are audited in both schemes: one of each palette color.
  const groups = await (await ctx.request.get(`${base}/api/groups`)).json();
  const colors = ["violet", "sky", "emerald", "amber", "rose"];
  const styled = await ctx.request.put(`${base}/api/groups`, {
    headers: { Origin: base },
    data: groups.map((g, i) => ({ ...g, color: colors[i % colors.length], ...(i === 0 ? { icon: "amazon" } : {}) })),
  });
  if (!styled.ok()) throw new Error(`styling groups failed: HTTP ${styled.status()}`);
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
    data: [
      ...config.widgets,
      { id: "sonarr-tile", type: "integration", integration: "sonarr-4k", view: "glance", visibility: "public" },
      // A public API widget (#302) reading the app's own health endpoint.
      {
        id: "health-api",
        type: "api",
        title: "App health",
        url: `${base}/api/health`,
        method: "GET",
        headers: [],
        body: "",
        display: "kv",
        fields: [{ label: "Status", path: "$.status", unit: "" }],
        max: 100,
        list: { path: "", label: "", value: "" },
        refresh: 60,
        visibility: "public",
        thresholds: { warn: null, critical: null, direction: "above" },
      },
      // A second notes card with content, for the sized cells below (#353);
      // the stock one stays empty for the tray check. Long enough to overflow
      // its 200px cell, so the card has to become a Tab stop (#355) — axe
      // flags an overflowing scroller nothing can focus.
      {
        id: "rules",
        type: "notes",
        title: "House rules",
        content: [
          "- Renew the TLS certificates before the 20th.",
          "- Back up the photo library to the second pool.",
          "- Rotate the offsite drive on the first Friday.",
          "- Patch the hypervisor after the backup completes.",
          "- Check the UPS battery every quarter.",
          "- Keep the spare NVMe in the drawer labelled.",
        ].join("\n"),
      },
      // And a short one, set taller than its content: the card has to fill
      // the height, not sit at its content's height with a gap below.
      { id: "parking", type: "notes", title: "Parking", content: "- Bay 3 is ours." },
    ],
  });
  if (!widgets.ok()) throw new Error(`adding the board widgets failed: HTTP ${widgets.status()} ${await widgets.text()}`);
  const media = await ctx.request.put(`${base}/api/boards/media/layout`, {
    headers: { Origin: base },
    data: { sections: [{ widget: "search" }, { widget: "sonarr-tile", span: 8 }, { widget: "health-api", span: 8 }, { widget: "bookmarks" }] },
  });
  if (!media.ok()) throw new Error(`placing the integration tile failed: HTTP ${media.status()}`);
  // Widgets at explicit heights on the private board (#353): a centered one,
  // a single card and a tile grid, each cut short of its content, and a
  // single card made taller than its content.
  const infra = await ctx.request.put(`${base}/api/boards/infra/layout`, {
    headers: { Origin: base },
    data: {
      sections: [
        { widget: "headerCard", span: 8, height: 160 },
        { widget: "rules", span: 16, height: 200 },
        { widget: "apps", span: 24, height: 220 },
        { widget: "parking", span: 12, height: 300 },
      ],
    },
  });
  if (!infra.ok()) throw new Error(`sizing the infra board's widgets failed: HTTP ${infra.status()}`);
  await ctx.close();
}

// An API widget's Test (#302) fetches with the form's values and shows what
// the widget would.
async function apiWidgetTest(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/admin?tab=settings&section=widgets`);
    await page.getByRole("button", { name: "Test", exact: true }).click();
    const shows = page.getByText("What the widget shows").locator("..");
    await shows.getByText("ok", { exact: true }).waitFor({ timeout: 15_000 });
    await shows.locator("..").screenshot({ path: path.join(OUT, "api-widget-test-light.png") });
    console.log("ok    the API widget's Test shows the mapped value");
  } catch (e) {
    failures.push(`API widget Test: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await page.close();
  }
}

// The layout editor's tray (#315): an empty widget shown from it can be
// hidden again, and Show moves focus to where the widget landed. Undone at
// the end, so the later phases see the stock board.
async function editorTray(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/?edit=1`);
    await page.getByRole("button", { name: "Show Notes" }).click();
    await page.getByText("Shown when it has content").first().waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "Hide Notes" }).click();
    await page.getByRole("button", { name: "Show Clock" }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-widget-id") === "clock", null, {
      timeout: 5_000,
    });
    for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "Show Clock" }).waitFor({ timeout: 5_000 });
    // Drag a card by its body (#312): the drop lands where the preview
    // showed, and one undo takes it back.
    const order = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("main .grid > [data-widget-id]")).map((e) => e.dataset.widgetId)
      );
    const before = await order();
    // Playwright scrolled the tray's Show button into view, and the landing
    // scroll (smooth) may still be running: back to the top, where both cards
    // of the drag are on screen. The page no longer snaps there on its own
    // (#341).
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const from = await page.locator('main .grid > [data-widget-id="search"]').boundingBox();
    const to = await page.locator('main .grid > [data-widget-id="greeting"]').boundingBox();
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2 - 20, { steps: 4 });
    await page.mouse.move(to.x + 20, to.y + 10, { steps: 15 });
    await page.waitForTimeout(300);
    const preview = await order();
    await page.mouse.up();
    const dropped = await order();
    if (dropped.join() === before.join() || dropped.join() !== preview.join())
      throw new Error(`drag: ${before} → preview ${preview} → dropped ${dropped}`);
    await page.keyboard.press("Control+z");
    if ((await order()).join() !== before.join()) throw new Error("drag: undo didn't restore the order");
    // Past the autosave's debounce, then its save.
    await page.waitForTimeout(1_500);
    await page.getByText("Saved").first().waitFor({ timeout: 10_000 });
    console.log("ok    the editor tray works, and a dragged card lands where its preview showed");
  } catch (e) {
    failures.push(`editor tray: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await page.close();
  }
}

// Resizing a card below the fold keeps the page where it is (#341): the
// grid's layout pass used to collapse the document for a moment and the
// browser clamped the scroll position to the top. A short viewport, every
// tray widget shown so the grid runs well past it, the last card selected and
// made taller, then the page's scroll position compared.
async function editorScroll(ctx) {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto(`${base}/?edit=1`);
    await page.locator("main .grid > [data-widget-id]").first().waitFor({ timeout: 10_000 });
    let shown = 0;
    for (; shown < 12; shown++) {
      const show = page.getByRole("button", { name: /^Show / }).first();
      if (!(await show.count())) break;
      await show.click();
      await page.waitForTimeout(300);
    }
    // Past the last landing scroll (smooth).
    await page.waitForTimeout(800);
    // The last card's top 140px down the viewport: room for its toolbar
    // above, and the click point on screen (Playwright would otherwise
    // scroll the card into view itself, moving the page before the app).
    const card = page.locator("main .grid > [data-widget-id]").last();
    await page.evaluate((el) => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 140), await card.elementHandle());
    await page.waitForTimeout(300);
    const scrollY = () => page.evaluate(() => window.scrollY);
    const before = await scrollY();
    if (before < 200) throw new Error(`the page only scrolled to ${before}px — not far enough to tell`);
    await card.click({ position: { x: 20, y: 20 } });
    await page.getByRole("toolbar", { name: /controls$/ }).waitFor({ timeout: 5_000 });
    await page.waitForTimeout(300);
    const selected = await scrollY();
    await page.getByRole("button", { name: /^Taller / }).first().click();
    await page.waitForTimeout(300);
    const taller = await scrollY();
    if (Math.abs(selected - before) > 4 || Math.abs(taller - before) > 4)
      throw new Error(`scrolled to ${before}px, ${selected}px after selecting the card, ${taller}px after making it taller`);
    // Put the layout back (the shows and the height), past the autosave.
    for (let i = 0; i < shown + 1; i++) await page.keyboard.press("Control+z");
    await page.waitForTimeout(1_500);
    await page.getByText("Saved").first().waitFor({ timeout: 10_000 });
    console.log("ok    resizing a card below the fold keeps the page where it is");
  } catch (e) {
    failures.push(`editor scroll: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await page.close();
  }
}

// A widget at an explicit height (#353): its cell is exactly that tall but
// no longer clips what's inside — the single card scrolls itself (and, as it
// overflows and holds nothing focusable, is a named Tab stop, #355), the tile
// grid scrolls in a box padded out past the cell by its shadows' allowance
// and marked while it overflows (its fade), and the centered card's content
// sits in a clip box that stands off the cell (#354). The editor's preview
// measures the same height.
async function sizedCells(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/b/infra`);
    await page.locator("main .grid > .widget-sized").first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    const cells = await page.evaluate(() => {
      const grid = document.querySelector("main .grid");
      const bleed = getComputedStyle(grid).getPropertyValue("--cell-bleed").trim();
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), height: Math.round(r.height) };
      };
      return Array.from(grid.children).map((cell) => {
        const cs = getComputedStyle(cell);
        const card = cell.querySelector(":scope > section > .glass-card");
        const tiles = cell.querySelector(":scope > section > .widget-tiles");
        const clip = cell.querySelector(":scope > .widget-clip");
        const heading = tiles?.previousElementSibling;
        return {
          bleed,
          sized: cell.classList.contains("widget-sized"),
          ...rect(cell),
          cardRect: card ? rect(card) : null,
          headingBottom: heading ? rect(heading).bottom : null,
          overflow: cs.overflowY,
          clip: clip ? { ...rect(clip), overflow: getComputedStyle(clip).overflowY } : null,
          card: card
            ? {
                overflow: getComputedStyle(card).overflowY,
                scrolls: card.scrollHeight > card.clientHeight,
                tabindex: card.getAttribute("tabindex"),
                role: card.getAttribute("role"),
                label: card.getAttribute("aria-label"),
              }
            : null,
          tiles: tiles
            ? {
                ...rect(tiles),
                overflow: getComputedStyle(tiles).overflowY,
                scrolls: tiles.scrollHeight > tiles.clientHeight,
                marked: tiles.hasAttribute("data-overflow"),
                tabindex: tiles.getAttribute("tabindex"),
                mask: getComputedStyle(tiles).maskImage,
                frosted: !document.documentElement.className.match(/\bdesign-(?!aero|frost|gradient)/),
              }
            : null,
        };
      });
    });
    const [header, notes, apps, parking] = cells;
    if (cells.length !== 4) throw new Error(`${cells.length} cells on the board, not 4`);
    if (header.height !== 160 || notes.height !== 200 || apps.height !== 220 || parking.height !== 300)
      throw new Error(`cells ${header.height}, ${notes.height}, ${apps.height} and ${parking.height}px tall, not 160, 200, 220 and 300`);
    // A card set taller than its content fills its cell down to the bottom.
    if (!parking.sized || !parking.cardRect || Math.abs(parking.cardRect.bottom - parking.bottom) > 1 || parking.card.scrolls)
      throw new Error(`the short notes card doesn't fill its 300px cell: card ${JSON.stringify(parking.cardRect)}, cell bottom ${parking.bottom}`);
    // The header card's cell never clips; the box inside it does, standing
    // off the cell by the bleed above and below and 16px beside.
    if (header.sized || header.overflow !== "visible" || !header.clip || header.clip.overflow !== "clip")
      throw new Error(`the header card's cell is ${header.overflow} with clip box ${JSON.stringify(header.clip)}`);
    const hb = parseInt(header.bleed, 10);
    const clipWant = { top: header.top - hb, bottom: header.bottom + hb, left: header.left - 16, right: header.right + 16 };
    for (const [side, want] of Object.entries(clipWant))
      if (Math.abs(header.clip[side] - want) > 1) throw new Error(`the clip box's ${side} is ${header.clip[side]}, not ${want}`);
    if (!notes.sized || notes.card?.overflow !== "auto" || notes.tiles)
      throw new Error(`the notes cell doesn't scroll its card: ${JSON.stringify(notes)}`);
    if (!notes.card.scrolls || notes.card.tabindex !== "0" || notes.card.role !== "region" || notes.card.label !== "House rules")
      throw new Error(`the overflowing notes card isn't a named Tab stop: ${JSON.stringify(notes.card)}`);
    if (apps.tiles?.tabindex) throw new Error("the tile box took a Tab stop although its tiles are focusable");
    if (!apps.sized || !apps.tiles) throw new Error(`the apps cell has no tile box: ${JSON.stringify(apps)}`);
    // The box reaches into the heading's bottom margin (so its top is the
    // heading's bottom edge), half a column gap past each side, and the row
    // gap (--cell-bleed) below the cell.
    const t = apps.tiles;
    const expected = { top: apps.headingBottom, left: apps.left - 16, right: apps.right + 16, bottom: apps.bottom + parseInt(apps.bleed, 10) };
    for (const [side, want] of Object.entries(expected))
      if (Math.abs(t[side] - want) > 1) throw new Error(`the tile box's ${side} is ${t[side]}, not ${want} (cell ${apps[side]}, bleed ${apps.bleed})`);
    // The fade is a mask, and a mask costs the frosted designs their blur, so
    // on those (the stock Glass among them) the box is marked but unmasked (#356).
    if (t.overflow !== "auto" || !t.scrolls || !t.marked || (t.mask === "none") !== t.frosted)
      throw new Error(`the tile box doesn't scroll and fade as its design should: ${JSON.stringify(t)}`);
    // The editor's preview of the apps card is the same 220px.
    await page.goto(`${base}/b/infra?edit=1`);
    const frame = page.locator('main .grid > [data-widget-id="apps"]');
    await frame.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await frame.click({ position: { x: 40, y: 10 } });
    await page.getByRole("toolbar", { name: /controls$/ }).waitFor({ timeout: 5_000 });
    const preview = await frame.locator("[inert]").evaluate((el) => Math.round(el.getBoundingClientRect().height));
    if (preview !== 220) throw new Error(`the editor's preview of the apps card is ${preview}px tall, not 220`);
    console.log("ok    sized cells keep their height, fill or scroll inside the card or tile box, and preview the same in the editor");
  } catch (e) {
    failures.push(`sized cells: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await page.close();
  }
}

// The sized-cell contract in WebKit, Safari's engine (#430), on the infra
// board addBoards seeded, in both schemes. WebKit, unlike Chrome 130+ and
// Firefox, never puts a plain overflowing scroll box in the Tab order, so the
// tabindex SizedCell sets (#355) is all that carries the keyboard contract
// there — a regression in it passes the Chromium run and shows only in
// Safari. The static contract sizedCells measures, then the keyboard: Tab
// reaches the cut-off notes card and it shows its ring; the arrow keys, Home
// and End scroll the card and leave the page where it is; grown to fit, the
// card drops its stop and a Tab sweep of the page skips it; cut short again,
// it takes the stop back. axe's scrollable-region-focusable rule, the one the
// issue cites. And the header card's clip box (#354): it stands off the cell,
// and the strip below the card looks the same with the clip lifted (nothing
// is cut) and different with the shadow removed (the shadow is drawn there).
//
// Headless WebKit (WPE) runs a rendering update only every second or so, at
// times only every ten, and ResizeObserver callbacks and keyboard-scroll
// animation steps run with those updates, so no step sleeps a fixed time:
// each waits for a frame (nextFrame, untilFrame) or polls for its outcome
// frame by frame (eventually), with a minute's budget. Keyboard scrolling is
// animated for as long as the key is held, so an arrow key is held until a
// frame has run the animation; End chains to the page once the card is at
// its bottom, so Home goes first. Only page errors count: the browser's
// first-visit location lookup is rate-limited (429) by repeated runs from
// one address and merely logs to the console.
async function webkitSizedCells() {
  const CARD = "main .grid > .widget-sized > section > .glass-card";
  for (const scheme of ["dark", "light"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const external = [];
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().startsWith(base)) external.push(`HTTP ${r.status()} ${new URL(r.url()).host}`);
    });
    // Where the keyboard focus is: on a sized card (and which), or on nothing.
    const focused = () =>
      page.evaluate((sel) => {
        const el = document.activeElement;
        return { card: !!el?.matches(sel), label: el?.getAttribute("aria-label") ?? null, body: !el || el === document.body };
      }, CARD);
    // The focused card's scroll position, and the page's.
    const scrolled = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return {
          label: el?.getAttribute("aria-label") ?? null,
          scrollTop: el?.scrollTop ?? -1,
          max: el ? el.scrollHeight - el.clientHeight : -1,
          pageY: window.scrollY,
        };
      });
    // The notes card's stop, as SizedCell keeps it.
    const notesCard = () =>
      page.evaluate(() => {
        const card = document.querySelectorAll("main .grid > *")[1]?.querySelector(":scope > section > .glass-card");
        return card
          ? { scrolls: card.scrollHeight > card.clientHeight, tabindex: card.getAttribute("tabindex"), role: card.getAttribute("role") }
          : { missing: true };
      });
    const resize = (height) =>
      page.evaluate((height) => {
        document.querySelectorAll("main .grid > *")[1].style.height = height;
      }, height);
    const around = (r, m) => ({ x: Math.max(0, r.x - m), y: Math.max(0, r.y - m), width: r.width + 2 * m, height: r.height + 2 * m });
    const t0 = Date.now();
    try {
      await page.goto(`${base}/b/infra`);
      await page.locator("main .grid > .widget-sized").first().waitFor({ timeout: 10_000 });
      // The static contract, once the hydrated cells have measured themselves.
      const measured = await eventually(page, () => measureCells(page), (cells) => cells[1]?.card?.tabindex === "0");
      const cells = measured.state;
      const [header, notes, apps, parking] = cells;
      if (cells.length !== 4) throw new Error(`${cells.length} cells on the board, not 4`);
      if (header.height !== 160 || notes.height !== 200 || apps.height !== 220 || parking.height !== 300)
        throw new Error(`cells ${header.height}, ${notes.height}, ${apps.height} and ${parking.height}px tall, not 160, 200, 220 and 300`);
      if (!notes.sized || notes.card?.overflow !== "auto" || !notes.card.scrolls || notes.card.tabindex !== "0" || notes.card.role !== "region" || notes.card.label !== "House rules")
        throw new Error(`the overflowing notes card isn't a named Tab stop: ${JSON.stringify(notes.card)}`);
      // WebKit has no overflow-clip-margin, so a sized cell leaves the
      // clipping to the card rather than clip at its own edge.
      if (notes.overflow !== "visible") throw new Error(`the sized cell clips at its edge (overflow ${notes.overflow}) instead of leaving that to the card`);
      if (!parking.card || parking.card.scrolls || parking.card.tabindex !== null)
        throw new Error(`the short notes card took a Tab stop: ${JSON.stringify(parking.card)}`);
      if (!apps.tiles || apps.tiles.tabindex) throw new Error(`the tile box took a Tab stop although its tiles are focusable: ${JSON.stringify(apps.tiles)}`);
      // The header card's cell never clips; the box inside it does, standing
      // off the cell by the bleed above and below and 16px beside (#354).
      if (header.sized || header.overflow !== "visible" || header.clip?.overflow !== "clip" || !header.innerCard)
        throw new Error(`the header card's cell is ${header.overflow} with clip box ${JSON.stringify(header.clip)}`);
      const clipWant = { top: header.top - header.bleed, bottom: header.bottom + header.bleed, left: header.left - 16, right: header.right + 16 };
      for (const [side, want] of Object.entries(clipWant))
        if (Math.abs(header.clip[side] - want) > 1) throw new Error(`the clip box's ${side} is ${header.clip[side]}, not ${want}`);

      // axe's rule for an overflowing region nothing can focus, in WebKit.
      await page.addScriptTag({ content: axeScript() });
      const violations = await page.evaluate(async () => {
        const { violations } = await window.axe.run(document, { runOnly: ["scrollable-region-focusable"], resultTypes: ["violations"] });
        return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      });
      if (violations.length) throw new Error(`axe: ${violations.join(" | ")}`);

      // Tab from the top of the page until the notes card has the focus, and
      // see its ring.
      await page.evaluate(() => window.scrollTo(0, 0));
      let presses = 0;
      for (;;) {
        await page.keyboard.press("Tab");
        presses++;
        const at = await focused();
        if (at.card && at.label === "House rules") break;
        if ((at.body && presses > 1) || presses >= 60)
          throw new Error(`Tab never reached the notes card (${presses} presses${at.body ? ", back on the body" : ""})`);
      }
      const ring = await page.evaluate(() => {
        const el = document.activeElement;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
      });
      if (!ring.visible || ring.style !== "solid" || !(ring.width >= 2))
        throw new Error(`the focused card shows no ring: outline ${ring.style} ${ring.width}px, focus-visible ${ring.visible}`);
      await page.screenshot({ path: path.join(OUT, `webkit-notes-focused-${scheme}.png`), clip: around(ring.rect, 24) });

      // Scroll the card with an arrow key held through a frame (up to three
      // holds), then Home, then End.
      let down;
      for (let hold = 0; hold < 3; hold++) {
        await page.keyboard.down("ArrowDown");
        await untilFrame(page);
        await page.keyboard.up("ArrowDown");
        down = await eventually(page, scrolled, (s) => s.scrollTop > 0, 2_000);
        if (down.ok) break;
      }
      if (!down.ok || down.state.label !== "House rules" || down.state.pageY !== 0)
        throw new Error(`the arrow keys didn't scroll the card, or scrolled the page: ${JSON.stringify(down.state)}`);
      await page.keyboard.press("Home");
      const home = await eventually(page, scrolled, (s) => s.scrollTop === 0);
      if (!home.ok || home.state.pageY !== 0) throw new Error(`Home didn't take the card back to its top: ${JSON.stringify(home.state)}`);
      await page.keyboard.press("End");
      const end = await eventually(page, scrolled, (s) => Math.abs(s.scrollTop - s.max) <= 1);
      if (!end.ok || end.state.pageY !== 0) throw new Error(`End didn't take the card to its bottom, or moved the page: ${JSON.stringify(end.state)}`);
      await page.screenshot({ path: path.join(OUT, `webkit-notes-scrolled-${scheme}.png`), clip: around(ring.rect, 24) });

      // Grown to fit its content, the card drops its stop as soon as the
      // engine delivers the resize, and a Tab sweep of the page then skips
      // every sized card; cut short again, it takes the stop back.
      await resize("600px");
      const grown = await eventually(page, notesCard, (s) => !s.scrolls && s.tabindex === null && s.role === null);
      if (!grown.ok) throw new Error(`grown to 600px, the card keeps its Tab stop: ${JSON.stringify(grown.state)}`);
      await page.evaluate(() => {
        document.querySelector("header a, header button, main a, main button")?.focus();
        window.scrollTo(0, 0);
      });
      let sweep = 0;
      for (; sweep < 80; sweep++) {
        await page.keyboard.press("Tab");
        const at = await focused();
        if (at.card) throw new Error(`a Tab sweep landed on a card that fits its cell (${at.label}, press ${sweep + 1})`);
        if (at.body) break;
      }
      await resize("200px");
      const shrunk = await eventually(page, notesCard, (s) => s.scrolls && s.tabindex === "0");
      if (!shrunk.ok) throw new Error(`cut short again, the card has no Tab stop: ${JSON.stringify(shrunk.state)}`);

      // The header card's shadow below the card (#354): the strip between the
      // card's bottom and the clip box's bottom, as is, with the clip lifted
      // and with the shadow removed — each style swap rendered by one frame.
      await page.evaluate(() => window.scrollTo(0, 0));
      await untilFrame(page);
      await page.screenshot({ path: path.join(OUT, `webkit-board-${scheme}.png`), fullPage: true });
      const strip = {
        x: header.innerCard.left + 12,
        y: header.innerCard.bottom + 1,
        width: header.innerCard.right - header.innerCard.left - 24,
        height: Math.max(2, header.clip.bottom - header.innerCard.bottom - 2),
      };
      const shot = (name) => page.screenshot({ path: path.join(OUT, `webkit-header-strip-${name}-${scheme}.png`), clip: strip });
      const asIs = await shot("asis");
      let tag = await page.addStyleTag({ content: ".widget-centered > .widget-clip { overflow: visible !important; }" });
      await untilFrame(page);
      const unclipped = await shot("unclipped");
      await tag.evaluate((el) => el.remove());
      tag = await page.addStyleTag({ content: ".widget-centered .glass-card { box-shadow: none !important; }" });
      await untilFrame(page);
      const noShadow = await shot("noshadow");
      await tag.evaluate((el) => el.remove());
      const vsNoShadow = await meanDiff(page, asIs, noShadow);
      const vsUnclipped = await meanDiff(page, asIs, unclipped);
      if (!(vsNoShadow > 0.5))
        throw new Error(`the header card's shadow isn't drawn below the card: mean pixel difference ${vsNoShadow.toFixed(2)} with the shadow removed (strip ${JSON.stringify(strip)})`);
      if (!(vsUnclipped < 0.05))
        throw new Error(`the header card's shadow is cut at the cell edge: mean pixel difference ${vsUnclipped.toFixed(3)} with the clip lifted`);
      console.log(
        `ok    WebKit (${scheme}): the cut-off card is a named Tab stop (press ${presses}) that scrolls from the keyboard, ` +
          `drops the stop grown to fit (${grown.ms} ms) and takes it back cut short (${shrunk.ms} ms; sweep of ${sweep} presses); ` +
          `the header card's shadow survives its clip box (pixel difference ${vsNoShadow.toFixed(2)} without it, ${vsUnclipped.toFixed(3)} unclipped); ` +
          `${Math.round((Date.now() - t0) / 1000)} s`
      );
    } catch (e) {
      failures.push(`sized cells in WebKit (${scheme}): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    } finally {
      if (errors.length) failures.push(`sized cells in WebKit (${scheme}): page errors: ${errors.join(" | ").slice(0, 300)}`);
      if (external.length) console.log(`WARN  WebKit (${scheme}): off-origin responses ignored: ${[...new Set(external)].join(", ")}`);
      await page.close();
      await ctx.close();
    }
  }
}

// Every cell of the board, as webkitSizedCells checks them: its box, whether
// it's sized and how it overflows, its clip box and the card inside it (the
// header), its card's stop (the notes) and its tile box's (the apps).
function measureCells(page) {
  return page.evaluate(() => {
    const grid = document.querySelector("main .grid");
    const bleed = parseInt(getComputedStyle(grid).getPropertyValue("--cell-bleed"), 10);
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), height: Math.round(r.height) };
    };
    return Array.from(grid.children).map((cell) => {
      const card = cell.querySelector(":scope > section > .glass-card");
      const tiles = cell.querySelector(":scope > section > .widget-tiles");
      const clip = cell.querySelector(":scope > .widget-clip");
      const inner = clip?.querySelector(".glass-card");
      return {
        bleed,
        sized: cell.classList.contains("widget-sized"),
        overflow: getComputedStyle(cell).overflowY,
        ...rect(cell),
        clip: clip ? { ...rect(clip), overflow: getComputedStyle(clip).overflowY } : null,
        innerCard: inner ? rect(inner) : null,
        card: card
          ? {
              overflow: getComputedStyle(card).overflowY,
              scrolls: card.scrollHeight > card.clientHeight,
              tabindex: card.getAttribute("tabindex"),
              role: card.getAttribute("role"),
              label: card.getAttribute("aria-label"),
            }
          : null,
        tiles: tiles ? { scrolls: tiles.scrollHeight > tiles.clientHeight, tabindex: tiles.getAttribute("tabindex") } : null,
      };
    });
  });
}

// One chance at headless WebKit's next rendering update — a frame, and with
// it the ResizeObserver callbacks and keyboard-scroll steps queued behind it:
// resolves to whether one ran within 800 ms, nudging the engine with a tiny
// screenshot when none did.
async function nextFrame(page) {
  const came = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let done = false;
        requestAnimationFrame(() => {
          done = true;
          resolve(true);
        });
        setTimeout(() => {
          if (!done) resolve(false);
        }, 800);
      })
  );
  if (!came) await page.screenshot({ clip: { x: 0, y: 0, width: 4, height: 4 } });
  return came;
}

// Wait for a frame, for up to `budgetMs`: the wait in ms, or -1.
async function untilFrame(page, budgetMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if (await nextFrame(page)) return Date.now() - t0;
  }
  return -1;
}

// Poll `probe` frame by frame until `ok` holds for what it returns, or
// `timeoutMs` pass: { ok, state, ms }, with the last state either way.
async function eventually(page, probe, ok, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const state = await probe();
    const ms = Date.now() - t0;
    if (ok(state)) return { ok: true, state, ms };
    if (ms > timeoutMs) return { ok: false, state, ms };
    await nextFrame(page);
  }
}

// The mean per-pixel RGB difference between two PNG screenshots of the same
// size, decoded by the page itself (no PNG library among the dependencies);
// -1 when their sizes differ.
function meanDiff(page, a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const g = canvas.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [pa, pb] = await Promise.all([pixels(a), pixels(b)]);
      if (pa.length !== pb.length) return -1;
      let sum = 0;
      for (let i = 0; i < pa.length; i += 4)
        sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
      return sum / (pa.length / 4);
    },
    [a.toString("base64"), b.toString("base64")]
  );
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
console.log(`\nSmoke test${BROWSER === "webkit" ? " (WebKit)" : ""} passed; screenshots in ${path.relative(ROOT, OUT) || OUT}`);
