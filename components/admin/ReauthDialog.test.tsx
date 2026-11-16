import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ReauthDialog from "./ReauthDialog";
import { requestReauth } from "./reauth";

// The "Confirm it's you" dialog for a session from a provider (#504): the
// provider's button, the password only when the account has one, and the
// popup's answer settling it.
afterEach(() => vi.unstubAllGlobals());

describe("ReauthDialog with a provider", () => {
  it("offers the provider and the password, and settles when the popup reports success", async () => {
    render(<ReauthDialog />);
    const fakePopup = { closed: false };
    vi.stubGlobal("open", vi.fn(() => fakePopup));
    let settled: Promise<boolean> = Promise.resolve(false);
    act(() => {
      settled = requestReauth(false, "confirm", { provider: "Nextcloud" });
    });
    const button = await screen.findByRole("button", { name: "Confirm with Nextcloud" });
    expect(screen.getByText(/through Nextcloud or with your password/)).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    fireEvent.click(button);
    expect(window.open).toHaveBeenCalledWith("/api/auth/oidc/start?purpose=reauth&popup=1", "ctrlcenter-oidc", expect.any(String));
    // The popup's last page posts the outcome back.
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "ctrlcenter:oidc", ok: true } }));
    });
    expect(await settled).toBe(true);
  });

  it("leaves the password out for an account that has none, and says why a confirmation failed", async () => {
    render(<ReauthDialog />);
    vi.stubGlobal("open", vi.fn(() => ({ closed: false })));
    act(() => {
      void requestReauth(false, "confirm", { provider: "Nextcloud", password: false });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm with Nextcloud" }));
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { origin: window.location.origin, data: { type: "ctrlcenter:oidc", ok: false, error: "mismatch" } })
      );
    });
    await waitFor(() => expect(screen.getByText(/different account/)).toBeDefined());
    // Requests share one dialog until it settles.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("ignores a message from another origin", async () => {
    render(<ReauthDialog />);
    vi.stubGlobal("open", vi.fn(() => ({ closed: false })));
    act(() => {
      void requestReauth(false, "confirm", { provider: "Nextcloud" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm with Nextcloud" }));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.test", data: { type: "ctrlcenter:oidc", ok: true } }));
    });
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});
