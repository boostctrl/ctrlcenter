import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AppItem } from "@/lib/schema";

// App cards (#274): one Tab stop each, P pins the focused card, and the
// search's top match is marked.
const toggleFavorite = vi.fn();
let favorites: string[] = [];
vi.mock("./PrefsProvider", () => ({
  useVisitorPrefs: () => ({ favorites, toggleFavorite, surfaceIsLight: false }),
}));

const { default: AppCard } = await import("./AppCard");

const app: AppItem = {
  id: "plex",
  name: "Plex",
  subtitle: "Media",
  url: "https://plex.example.com",
  icon: "",
  expectStatus: "",
  checkType: "http",
  keyword: "",
  private: false,
};

beforeEach(() => {
  toggleFavorite.mockClear();
  favorites = [];
});

describe("AppCard", () => {
  it("is a single Tab stop: the pin button is out of the Tab order", () => {
    render(<AppCard app={app} />);
    const link = screen.getByRole("link", { name: "Plex" });
    expect(link.getAttribute("tabindex")).toBeNull();
    const pin = screen.getByRole("button", { name: "Pin Plex to favorites" });
    expect(pin.getAttribute("tabindex")).toBe("-1");
  });

  it("pins with P on the focused card, ignoring modified keys", () => {
    render(<AppCard app={app} />);
    const link = screen.getByRole("link", { name: "Plex" });
    expect(link.getAttribute("aria-keyshortcuts")).toBe("P");
    fireEvent.keyDown(link, { key: "p" });
    fireEvent.keyDown(link, { key: "P" });
    fireEvent.keyDown(link, { key: "p", ctrlKey: true });
    fireEvent.keyDown(link, { key: "x" });
    expect(toggleFavorite).toHaveBeenCalledTimes(2);
    expect(toggleFavorite).toHaveBeenCalledWith("plex");
  });

  it("labels the pin as Unpin once favorited", () => {
    favorites = ["plex"];
    render(<AppCard app={app} />);
    expect(screen.getByRole("button", { name: "Unpin Plex" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("outlines the search's top match only", () => {
    const { container, rerender } = render(<AppCard app={app} />);
    expect(container.firstElementChild?.className).not.toMatch(/outline-2/);
    rerender(<AppCard app={app} top />);
    expect(container.firstElementChild?.className).toMatch(/outline-2/);
  });
});
