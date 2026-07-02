// Screenshot a page of the locally running standalone build and fail loudly
// on broken assets or JS errors — the CSS-404 case an HTML-only smoke test
// sails past. Uses playwright-core (already a transitive dependency) and the
// Chromium in ~/.cache/ms-playwright.
//
//   node .claude/skills/visual-verify/screenshot.mjs <url> <out.png> [dark]
//
// Fails on: same-origin 4xx/5xx or failed requests, uncaught page errors, or
// zero stylesheets. Off-origin trouble (weather geolocation rate limits, …)
// and aborted Next.js ?_rsc= prefetches are printed as warnings only.
import { chromium } from "playwright-core";

const [url, out, scheme] = process.argv.slice(2);
if (!url || !out) {
  console.error(
    "Usage: node .claude/skills/visual-verify/screenshot.mjs <url> <out.png> [dark]"
  );
  process.exit(2);
}
const origin = new URL(url).origin;
const ours = (u) => u.startsWith(origin);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme === "dark" ? "dark" : "light",
});

const failures = [];
const warnings = [];
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

await page.goto(url, { waitUntil: "networkidle" });

const styled = await page.evaluate(() => document.styleSheets.length > 0);
if (!styled)
  failures.push(
    "no stylesheets loaded — was .next/static copied into .next/standalone/.next/ ?"
  );

await page.screenshot({ path: out, fullPage: true });
await browser.close();

for (const w of warnings) console.error(`WARN  ${w}`);
for (const f of failures) console.error(`FAIL  ${f}`);
if (failures.length) process.exit(1);
console.log(`OK ${out}`);
