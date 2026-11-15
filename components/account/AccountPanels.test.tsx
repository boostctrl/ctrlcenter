import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountPanels from "./AccountPanels";

// The account page (#423) when an admin requires a second factor of the
// account (#449): it says so until there is one, and then offers no way to
// turn it off.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));

afterEach(() => vi.unstubAllGlobals());

const mount = (twoFactorEnabled: boolean, twoFactorRequired: boolean) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ sessions: [], current: null })));
  return render(
    <AccountPanels twoFactorEnabled={twoFactorEnabled} twoFactorRequired={twoFactorRequired} mustChangePassword={false} />
  );
};

describe("AccountPanels (#449)", () => {
  it("asks for the required second factor until there is one", () => {
    mount(false, true);
    expect(screen.getByText(/An admin requires two-factor authentication for your account/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Enable" })).toBeDefined();
  });

  it("offers no way to turn a required second factor off", () => {
    mount(true, true);
    expect(screen.queryByText(/An admin requires two-factor authentication/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    expect(screen.getByText(/required for your account by an admin/)).toBeDefined();
  });

  it("leaves an account without the requirement as it was", () => {
    mount(true, false);
    expect(screen.getByRole("button", { name: "Disable" })).toBeDefined();
  });
});
