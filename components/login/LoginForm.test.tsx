import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import LoginForm from "./LoginForm";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

// Whose name the form starts with (#450): `admin` while that is the only
// account, nothing once there are more, the name used last in this browser
// over both.
describe("LoginForm", () => {
  beforeEach(() => window.localStorage.clear());

  it("prefills admin only while that is the one account", () => {
    const one = render(<LoginForm passwordConfigured singleAccount />);
    expect((screen.getByLabelText(/^Username/) as HTMLInputElement).value).toBe("admin");
    expect(screen.queryByText(/founding account/)).toBeNull();
    // Nothing to type there, so focus starts in the password field.
    expect(document.activeElement).toBe(screen.getByLabelText(/^Password/));
    one.unmount();
    render(<LoginForm passwordConfigured singleAccount={false} />);
    expect((screen.getByLabelText(/^Username/) as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/founding account/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Username/));
  });

  it("starts with the name used last in this browser", async () => {
    window.localStorage.setItem("ctrlcenter:signin-name", "sam");
    render(<LoginForm passwordConfigured singleAccount={false} />);
    await waitFor(() => expect((screen.getByLabelText(/^Username/) as HTMLInputElement).value).toBe("sam"));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Password/));
  });
});
