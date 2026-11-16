// Where a personal API token (#538) may be used: a short list of routes by
// method and path, and nothing else — not settings, accounts, groups,
// tokens, sessions, or a backup's export or import. Read-only routes for
// every token; the dashboard actions (and the Portainer views that sit
// behind the same opt-in) only for a token with the actions scope. Pure, so
// the proxy and the routes share it.
import type { TokenScope } from "./api-tokens";

const READ: RegExp[] = [
  /^\/api\/status$/,
  /^\/api\/status\/history$/,
  /^\/api\/status\/history\/[^/]+$/,
  /^\/api\/status\/badge\/[^/]+$/,
  /^\/api\/monitor$/,
  /^\/api\/monitor\/(?!action$|test$|portainer$)[^/]+$/,
  /^\/api\/monitor\/(?!action$|test$|portainer$)[^/]+\/history$/,
  /^\/api\/apps$/,
  /^\/api\/bookmarks$/,
];
const ACTIONS: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/monitor\/action$/ },
  { method: "GET", path: /^\/api\/monitor\/portainer\/containers$/ },
  { method: "GET", path: /^\/api\/monitor\/portainer\/logs$/ },
];

// Whether a token of `scope` may make this request. Without a scope:
// whether any token could, for the proxy to let it through to the route.
export function tokenAllowed(method: string, pathname: string, scope?: TokenScope): boolean {
  const m = method.toUpperCase();
  if ((m === "GET" || m === "HEAD") && READ.some((r) => r.test(pathname))) return true;
  if (scope === "read") return false;
  return ACTIONS.some((a) => a.method === m && a.path.test(pathname));
}

// Whether this request is an action a token with the actions scope stands
// in for the step-up on (#366): the token itself is the credential.
export function tokenActionRoute(method: string, pathname: string): boolean {
  return ACTIONS.some((a) => a.method === method.toUpperCase() && a.path.test(pathname));
}

// The token a request carries: "Authorization: Bearer cct_…", or null.
export function bearerOf(headers: Headers): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "");
  return m ? m[1] : null;
}
