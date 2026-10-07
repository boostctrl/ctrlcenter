// Screenshot a page of the locally running standalone build and fail loudly
// on broken assets or JS errors — the CSS-404 case an HTML-only smoke test
// sails past. The checks live in scripts/page-check.mjs (shared with
// `npm run smoke`); playwright-core is a devDependency.
//
//   node .claude/skills/visual-verify/screenshot.mjs <url> <out.png> [dark]
//
// Set CHROMIUM_PATH to use a preinstalled Chromium whose revision doesn't
// match playwright-core (e.g. /opt/pw-browsers/chromium in cloud sessions).
//
// Fails on: same-origin 4xx/5xx or failed requests, uncaught page errors, or
// zero stylesheets. Off-origin trouble (weather geolocation rate limits, …)
// and aborted Next.js ?_rsc= prefetches are printed as warnings only.
import { launchBrowser, checkPage } from "../../../scripts/page-check.mjs";

const [url, out, scheme] = process.argv.slice(2);
if (!url || !out) {
  console.error(
    "Usage: node .claude/skills/visual-verify/screenshot.mjs <url> <out.png> [dark]"
  );
  process.exit(2);
}

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme === "dark" ? "dark" : "light",
});
const { failures, warnings } = await checkPage(context, url, { screenshot: out });
await browser.close();

for (const w of warnings) console.error(`WARN  ${w}`);
for (const f of failures) console.error(`FAIL  ${f}`);
if (failures.length) process.exit(1);
console.log(`OK ${out}`);
