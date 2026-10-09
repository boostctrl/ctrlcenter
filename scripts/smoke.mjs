// Browser smoke test of the production build, run in CI after `npm run build`
// (and locally via `npm run smoke`). Assembles the standalone output the way
// the Dockerfile does, serves it against a scratch copy of the example config,
// and renders the key pages in headless Chromium — failing on broken assets,
// same-origin errors, page errors, or a missing stylesheet. Then signs in
// through the real login form and renders the admin pages.
//
// Screenshots land in $SMOKE_OUT (default smoke-screenshots/) for upload as a
// CI artifact. Needs a Chromium for playwright-core: `npx playwright-core
// install chromium`, or CHROMIUM_PATH pointing at one.
import { spawn } from "node:child_process";
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
let browser;
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
    });
    for (const w of result.warnings) console.log(`WARN  ${pathname}: ${w}`);
    for (const f of result.failures) failures.push(`${pathname}: ${f}`);
    console.log(`${result.failures.length ? "FAIL" : "ok  "}  ${pathname} (${shot})`);
    return result;
  };

  // Public pages, signed out.
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    const pages =
      scheme === "light"
        ? ["/", "/status", "/weather", "/calendar", "/help", "/settings", "/admin/login"]
        : ["/", "/status"];
    for (const p of pages) {
      await run(ctx, p, `${p === "/" ? "home" : p.slice(1).replace(/\//g, "-")}-${scheme}`);
    }
    // Admin pages bounce a signed-out visitor to the login form.
    if (scheme === "light") {
      const r = await run(ctx, "/admin", "admin-signed-out");
      if (!new URL(r.finalUrl).pathname.startsWith("/admin/login")) {
        failures.push(`/admin: signed-out visitor landed on ${r.finalUrl}, not the login page`);
      }
    }
    await ctx.close();
  }

  // Sign in through the real form, then render the admin pages.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await ctx.newPage();
  await login.goto(`${base}/admin/login`);
  await login.fill('input[type="password"]', PASSWORD);
  await login.keyboard.press("Enter");
  await login.waitForURL((u) => u.pathname === "/admin", { timeout: 15_000 });
  await login.close();
  console.log("ok    signed in through /admin/login");
  for (const [p, shot] of [
    ["/admin", "admin"],
    ["/admin?tab=settings", "admin-settings"],
    ["/admin/monitor", "admin-monitor"],
  ]) {
    await run(ctx, p, shot);
  }
  await ctx.close();
} catch (e) {
  failures.push(`smoke run aborted: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n--- server log (${logPath}) ---\n${fs.readFileSync(logPath, "utf8")}`);
  process.exit(1);
}
console.log(`\nSmoke test passed; screenshots in ${path.relative(ROOT, OUT) || OUT}`);
