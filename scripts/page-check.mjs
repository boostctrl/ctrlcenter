// Render a page of the running standalone build in headless Chromium and
// collect what's broken: same-origin 4xx/5xx or failed requests, uncaught page
// errors, or zero stylesheets (the CSS-404 case an HTML-only smoke test sails
// past). Shared by `npm run smoke` (scripts/smoke.mjs, run in CI) and the
// visual-verify skill's screenshot CLI.
//
// Off-origin trouble (weather geolocation rate limits, …), console errors and
// aborted Next.js ?_rsc= prefetches are reported as warnings only.
//
// With `axe: true` the page is also audited with axe-core against WCAG 2.1 A
// and AA plus axe's best-practice rules (contrast, labels, landmarks, heading
// order, …); every violation is a failure, so regressions like light-mode text
// dropping under 4.5:1 (#273) or content outside a landmark (#274) can't land.
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
let axeSource;
function axeScript() {
  axeSource ??= fs.readFileSync(
    createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
    "utf8"
  );
  return axeSource;
}

// Uses Playwright's own Chromium (`npx playwright-core install chromium`), or
// the binary at CHROMIUM_PATH when that's set — e.g. a preinstalled browser
// whose revision doesn't match this playwright-core version.
export function launchBrowser() {
  return chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
}

// Wait for the page's same-origin requests to go quiet. Not Playwright's
// "networkidle": since Next 16.4, a signed-out visitor's background prefetch
// of /admin (redirected to /admin/login?…&_rsc=…) never settles in Chromium,
// so network idle never arrives. Router prefetches (_rsc) don't block here.
async function settle(page, origin, { quietMs = 500, timeoutMs = 15000 } = {}) {
  const pending = new Set();
  const track = (r) => {
    const u = r.url();
    if (u.startsWith(origin) && !u.includes("_rsc=")) pending.add(r);
  };
  const done = (r) => pending.delete(r);
  page.on("request", track);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  const start = Date.now();
  let quietSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pending.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) break;
    await page.waitForTimeout(100);
  }
  page.off("request", track);
  page.off("requestfinished", done);
  page.off("requestfailed", done);
}

// Check one page. `context` is a Playwright BrowserContext (so callers control
// cookies and color scheme); `screenshot` is an optional output path; `axe`
// adds the accessibility audit.
export async function checkPage(context, url, { screenshot, axe = false } = {}) {
  const origin = new URL(url).origin;
  const ours = (u) => u.startsWith(origin);
  const failures = [];
  const warnings = [];
  const page = await context.newPage();
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "failed";
    // Aborted requests are routine (router prefetches cancelled on settle).
    if (err.includes("ERR_ABORTED")) return;
    (ours(r.url()) ? failures : warnings).push(`request failed: ${err} ${r.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      (ours(r.url()) ? failures : warnings).push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e}`));
  page.on("console", (m) => {
    if (m.type() === "error") warnings.push(`console error: ${m.text()}`);
  });

  await page.goto(url, { waitUntil: "load" });
  await settle(page, origin);

  const styled = await page.evaluate(() => document.styleSheets.length > 0);
  if (!styled)
    failures.push(
      "no stylesheets loaded — was .next/static copied into .next/standalone/.next/ ?"
    );
  if (axe) {
    await page.addScriptTag({ content: axeScript() });
    const violations = await page.evaluate(async (tags) => {
      const { violations } = await window.axe.run(document, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations"],
      });
      return violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map(
          (n) =>
            `${n.target.join(" ")} — ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? v.help}`
        ),
      }));
    }, AXE_TAGS);
    for (const v of violations) {
      failures.push(
        `a11y ${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).join(" | ")}`
      );
    }
  }
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  const finalUrl = page.url();
  await page.close();
  return { failures, warnings, finalUrl };
}
