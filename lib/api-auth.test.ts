import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";

// Structural guard: admin authorization must not live only in proxy.ts. A
// proxy bypass (GHSA-6gpp-xcg3-4w24 affected Next ≤16.3.5) would otherwise hand
// an anonymous request the config export, settings, and every mutation. So
// every route handler re-checks the session itself, and every admin page calls
// requireAdminPage — this test fails the moment a new one forgets.

const ROOT = path.join(__dirname, "..");

async function collect(dir: string, file: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collect(full, file)));
    else if (entry.name === file) found.push(path.relative(ROOT, full));
  }
  return found.sort();
}

// Route files whose handlers are deliberately reachable without a session.
// Each authenticates some other way or serves only public data.
const PUBLIC_ROUTES = [
  // Orchestrator liveness probe.
  "app/api/health/route.ts",
  // Auth itself: issuing and clearing the session.
  "app/api/login/route.ts",
  "app/api/logout/route.ts",
  // Inbound webhooks (#204): authenticated by a per-service URL token.
  "app/api/hooks/[service]/route.ts",
  // Icons render on the public dashboard; the /api/icons collection
  // (list/upload/delete) is not listed here and stays gated.
  "app/api/icons/[name]/route.ts",
  "app/api/icons/cdn/[slug]/route.ts",
  "app/api/icons/metadata/route.ts",
  // The public status page; each filters private apps per response.
  "app/api/status/route.ts",
  "app/api/status/history/route.ts",
  "app/api/status/history/[id]/route.ts",
];

// The session checks a handler may use: the plain one, or the integration
// action guard (lib/services/guard.ts), which runs it first.
const GUARDS = ["isAdminRequest(", "requireAction("];

describe("admin authorization doesn't rely on the proxy alone", () => {
  it("every non-public route handler checks the session itself", async () => {
    const routes = await collect(path.join(ROOT, "app", "api"), "route.ts");
    const unguarded: string[] = [];
    for (const route of routes) {
      if (PUBLIC_ROUTES.includes(route)) continue;
      const source = await fs.readFile(path.join(ROOT, route), "utf8");
      // Split on each exported handler so one guarded method can't vouch for
      // an unguarded sibling in the same file.
      const handlers = source.split(/^export async function /m).slice(1);
      for (const body of handlers) {
        if (!GUARDS.some((g) => body.includes(g))) {
          unguarded.push(`${route} ${body.slice(0, body.indexOf("("))}`);
        }
      }
    }
    expect(
      unguarded,
      "Admin route handlers must call isAdminRequest (or requireAction) " +
        "themselves; add a route to PUBLIC_ROUTES only if it's meant to be " +
        "anonymous."
    ).toEqual([]);
  });

  it("the public allowlist only names routes that exist", async () => {
    const routes = await collect(path.join(ROOT, "app", "api"), "route.ts");
    expect(PUBLIC_ROUTES.filter((r) => !routes.includes(r))).toEqual([]);
  });

  it("every admin page except login calls requireAdminPage", async () => {
    const pages = await collect(path.join(ROOT, "app", "admin"), "page.tsx");
    const unguarded: string[] = [];
    for (const page of pages) {
      if (page === path.join("app", "admin", "login", "page.tsx")) continue;
      const source = await fs.readFile(path.join(ROOT, page), "utf8");
      if (!source.includes("requireAdminPage(")) unguarded.push(page);
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(unguarded).toEqual([]);
  });
});
