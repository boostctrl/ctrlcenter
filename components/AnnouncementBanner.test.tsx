import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnnouncementBanner from "./AnnouncementBanner";

// A browser that blocks site data throws SecurityError on any localStorage
// access. The banner is in the root layout, so a throw there used to send
// every page to the error screen (#390).
describe("AnnouncementBanner with storage blocked (#390)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("still renders, and dismissing hides it for the page", async () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);

    render(<AnnouncementBanner message="Maintenance tonight" tone="info" dismissible />);
    screen.getByText("Maintenance tonight");
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss announcement" }));
    expect(screen.queryByText("Maintenance tonight")).toBeNull();
  });

  it("remembers a dismissal where storage works", async () => {
    const { unmount } = render(<AnnouncementBanner message="Remember me" tone="info" dismissible />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss announcement" }));
    unmount();
    render(<AnnouncementBanner message="Remember me" tone="info" dismissible />);
    expect(screen.queryByText("Remember me")).toBeNull();
    localStorage.clear();
  });
});
