// The answers the provider sign-in routes give (#504): back to the sign-in
// form with a reason, on to where the person was going, or — for a sign-in
// or confirmation run in a popup the page opened — a page that tells the
// opener how it went and closes.
import { NextResponse, type NextRequest } from "next/server";
import { isHttps } from "./auth";
import { OIDC_FLOW_COOKIE, publicOrigin } from "./oidc";

// Why a provider sign-in didn't end in a session, as the sign-in form says it.
// "no-header": the reverse proxy didn't say who this is, or isn't trusted.
// "not-linked": no account here is connected to that provider identity;
// "taken": a new account's name is already an account here (#555);
// "in-use": connecting, an identity another account here holds.
export type OidcFailure =
  | "not-linked"
  | "taken"
  | "in-use"
  | "off"
  | "expired"
  | "denied"
  | "provider"
  | "name"
  | "no-account"
  | "disabled"
  | "mismatch"
  | "no-header";

export function flowCookieOptions(request: NextRequest, maxAge: number, path = "/api/auth/oidc") {
  return { httpOnly: true, secure: isHttps(request), sameSite: "lax" as const, path, maxAge };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

// The popup's last page: it tells the page that opened it how it went —
// on a BroadcastChannel, which still reaches it when the provider's pages
// cut the popup's link to its opener, and by postMessage (same origin only)
// — and closes. Its script carries the request's CSP nonce; should nothing
// be listening, the text says what happened.
export function popupResult(request: NextRequest, result: { ok: boolean; error?: OidcFailure }): NextResponse {
  const nonce = request.headers.get("x-nonce") ?? "";
  const message = JSON.stringify({ type: "ctrlcenter:oidc", ...result }).replace(/</g, "\\u003c");
  const text = result.ok ? "Done. You can close this window." : "That didn't work. You can close this window and try again.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CtrlCenter</title></head><body style="font-family:system-ui,sans-serif;padding:2rem"><p>${escapeHtml(text)}</p><script nonce="${escapeHtml(nonce)}">var m=${message};try{new BroadcastChannel("ctrlcenter-oidc").postMessage(m)}catch(e){}try{if(window.opener)window.opener.postMessage(m,location.origin)}catch(e){}window.close();</script></body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
  return res;
}

// Back to the account page from connecting a provider (#555), saying why it
// didn't.
export function failLink(request: NextRequest, error: OidcFailure): NextResponse {
  const url = new URL("/account", publicOrigin(request));
  url.searchParams.set("providerError", error);
  const res = NextResponse.redirect(url, 303);
  res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
  return res;
}

// Back to the sign-in form, saying why. `name` is the sign-in name the
// provider gave, for "no account named …".
export function failSignIn(
  request: NextRequest,
  error: OidcFailure,
  opts: { popup?: boolean; next?: string; name?: string } = {}
): NextResponse {
  if (opts.popup) return popupResult(request, { ok: false, error });
  const url = new URL("/login", publicOrigin(request));
  url.searchParams.set("error", error);
  if (opts.name) url.searchParams.set("name", opts.name);
  if (opts.next && opts.next !== "/") url.searchParams.set("next", opts.next);
  const res = NextResponse.redirect(url, 303);
  res.cookies.delete({ name: OIDC_FLOW_COOKIE, path: "/api/auth/oidc" });
  return res;
}
