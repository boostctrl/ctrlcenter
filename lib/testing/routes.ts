// Helpers for route-handler tests (#289): call a route's exported handler with
// a real NextRequest against a scratch config file, so auth, CSRF and
// validation run exactly as in production.
//
// lib/config captures CONFIG_PATH at module load, so this file must not import
// it (or anything that does) statically: a test calls useScratchConfig() in
// beforeAll, THEN dynamically imports the route under test.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

export const TEST_ORIGIN = "http://dash.test";
// The session cookie's name (lib/auth's SESSION_COOKIE_NAME), duplicated so
// this module stays free of lib/auth's config imports.
const SESSION_COOKIE = "homepage_admin_session";

// Point CONFIG_PATH at a fresh scratch directory (optionally seeding the file)
// and pin the session secret. Returns the config path.
export async function useScratchConfig(yaml?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-route-"));
  const configPath = path.join(dir, "config.yaml");
  process.env.CONFIG_PATH = configPath;
  process.env.SESSION_SECRET = "route-test-secret-route-test-secret";
  if (yaml !== undefined) await fs.writeFile(configPath, yaml, "utf8");
  return configPath;
}

export type RequestInit = {
  method?: string;
  body?: unknown;
  // A session token to send as the admin cookie.
  session?: string;
  headers?: Record<string, string>;
};

// A same-origin browser request by default (Sec-Fetch-Site: same-origin);
// override the header to simulate a cross-site one.
export function request(pathname: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers({
    host: new URL(TEST_ORIGIN).host,
    "sec-fetch-site": "same-origin",
    ...init.headers,
  });
  if (init.session) headers.set("cookie", `${SESSION_COOKIE}=${init.session}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(pathname, TEST_ORIGIN), {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// A valid admin session for the config's current password hash ("" when the
// password comes from ADMIN_PASSWORD).
export async function adminSession(passwordHash = ""): Promise<string> {
  const { createSessionToken } = await import("../auth");
  return createSessionToken(passwordHash);
}

// The `{ params }` second argument dynamic route handlers receive.
export function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}
