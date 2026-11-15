import { describe, it, expect } from "vitest";
import { allowedBeforeTwoFactor } from "./two-factor-gate";

// Where an account that must set up two-factor may go (#449): its page and
// that page's calls, matched as whole path segments.
describe("allowedBeforeTwoFactor", () => {
  it("lets through the account page and the calls it makes", () => {
    for (const path of ["/account", "/login", "/api/2fa/setup", "/api/2fa/activate", "/api/password", "/api/sessions/others", "/api/reauth", "/api/logout"])
      expect(allowedBeforeTwoFactor(path), path).toBe(true);
  });

  it("holds back everything else, a path that only starts the same way included", () => {
    for (const path of ["/", "/b/home", "/admin", "/admin/monitor", "/accounts", "/api/accounts", "/api/2factor", "/api/status", "/api/apps"])
      expect(allowedBeforeTwoFactor(path), path).toBe(false);
  });
});
