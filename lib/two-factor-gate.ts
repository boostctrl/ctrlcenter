// Where an account that must set up two-factor may go (#449). An admin can
// require a second factor of an account; until it has one, the account
// reaches only its own page and the calls that page makes, so it can set the
// factor up (and change its password, see its sessions, confirm it's itself
// and sign out). Everything else answers as it would to a visitor, or sends
// the account back to its page.

// The pages: the account's own, and signing in again.
const PAGES = ["/account", "/login", "/admin/login"];

// The APIs the account page uses.
const APIS = ["/api/2fa", "/api/password", "/api/sessions", "/api/reauth", "/api/login", "/api/logout", "/api/auth"];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function allowedBeforeTwoFactor(pathname: string): boolean {
  return [...PAGES, ...APIS].some((p) => under(pathname, p));
}

// Where a page request goes instead.
export const TWO_FACTOR_SETUP_PAGE = "/account";
