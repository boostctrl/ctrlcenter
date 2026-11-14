import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "./Toast";
import ChangePassword from "./ChangePassword";

// The one card, two wordings (#423): the admin portal's Security card
// explains the ADMIN_PASSWORD fallback; the account page speaks to whoever
// is signed in.
describe("ChangePassword", () => {
  it("speaks to the account on its own page, with no mention of the admin", async () => {
    render(
      <ToastProvider>
        <ChangePassword own />
      </ToastProvider>
    );
    expect(screen.getByText("Your password")).toBeTruthy();
    expect(screen.queryByText(/ADMIN_PASSWORD/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("dialog", { name: "Change password" })).toBeTruthy();
    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });

  // #489: Escape closed the popover but left both passwords typed in it.
  it("clears the fields when Escape closes it, as Cancel does", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ChangePassword own />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await user.type(screen.getByLabelText("Current password"), "old-secret");
    await user.type(screen.getByLabelText("New password (min 12 characters)"), "new-secret");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Change password" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("New password (min 12 characters)") as HTMLInputElement).value).toBe("");
  });

  it("keeps the admin portal's wording by default", () => {
    render(
      <ToastProvider>
        <ChangePassword />
      </ToastProvider>
    );
    expect(screen.getByText("Admin password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });
});
