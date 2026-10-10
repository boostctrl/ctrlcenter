import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configSchema, type AppItem } from "@/lib/schema";

vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));

const { default: AdminDashboard } = await import("./AdminDashboard");

// The admin tabs share one copy of the apps, bookmarks and theme overrides,
// and keep what a tab holds across a switch away and back (#317).
const config = configSchema.parse({});
const saved: AppItem = configSchema.parse({ apps: [{ id: "a1", name: "Jellyfin", url: "http://jf.lan" }] }).apps[0];

function renderAdmin() {
  return render(
    <AdminDashboard
      initialApps={[]}
      initialBookmarks={[]}
      initialSettings={config.settings}
      initialWidgets={config.widgets}
      initialBoards={config.boards}
      initialGroups={[]}
      initialIntegrations={[]}
      initialThemes={[]}
      initialTwoFactorEnabled={false}
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("AdminDashboard tabs (#317)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/apps" && init?.method === "POST") return Response.json(saved);
        return Response.json({});
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("still lists an app added before switching tabs and back", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.type(screen.getByLabelText("Name"), "Jellyfin");
    await user.type(screen.getByLabelText("URL"), "http://jf.lan");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Application added");
    await user.click(tab("Bookmarks"));
    await user.click(tab("Applications"));
    expect(within(screen.getByRole("main")).getAllByText("Jellyfin").length).toBeGreaterThan(0);
  });

  it("keeps an unsaved Settings edit across a switch away and back", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(tab("Settings"));
    const title = screen.getByLabelText("Page title");
    await user.clear(title);
    await user.type(title, "Homelab");
    await user.click(tab("Applications"));
    await user.click(tab("Settings"));
    expect(screen.getByLabelText<HTMLInputElement>("Page title").value).toBe("Homelab");
  });
});
