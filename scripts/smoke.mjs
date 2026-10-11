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
    }
    await ctx.close();
  }

  await statusPhase(run);
  await setupPhase(run);
  await upgradePhase(run);
} catch (e) {
  failures.push(`smoke run aborted: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser?.close();
  server.kill();
  tlsServer?.close();
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
    ],
  });
  if (!widgets.ok()) throw new Error(`adding the board widgets failed: HTTP ${widgets.status()} ${await widgets.text()}`);
  const media = await ctx.request.put(`${base}/api/boards/media/layout`, {
    headers: { Origin: base },
    data: { sections: [{ widget: "search" }, { widget: "sonarr-tile", span: 8 }, { widget: "health-api", span: 8 }, { widget: "bookmarks" }] },
  });
  if (!media.ok()) throw new Error(`placing the integration tile failed: HTTP ${media.status()}`);
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
