import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { configSchema } from "@/lib/schema";

vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));

const { default: AdminDashboard } = await import("../AdminDashboard");

// A window whose end is before its start (an overnight window entered on one
// date) or can't be read counts as over when it holds apps, so the editor
// says so rather than leaving the admin to find out from an alert (#391).
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function renderAnnouncements(entries: object[]) {
  const config = configSchema.parse({
    apps: [{ id: "nas", name: "NAS", url: "http://nas" }],
    settings: { statusAnnouncements: entries },
  });
  return render(
    <AdminDashboard
      initialApps={config.apps}
      initialBookmarks={[]}
      initialSettings={config.settings}
      initialWidgets={config.widgets}
      initialBoards={config.boards}
      initialGroups={[]}
      initialIntegrations={[]}
      initialThemes={[]}
      initialTwoFactorEnabled={false}
      initialTab="settings"
      initialSection="announcements"
    />
  );
}

describe("Announcements editor and broken windows (#391)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const now = Date.now();
  const overnight = { startsAt: iso(now - HOUR), endsAt: iso(now - 23 * HOUR) };

  it("warns that a maintenance window ending before it starts counts as over", () => {
    renderAnnouncements([{ id: "m", kind: "maintenance", apps: ["nas"], ...overnight }]);
    screen.getByText(/This ends before it starts\..*counts as over, so its apps alert/);
    screen.getByText("Expired");
  });

  it("warns that a notice's unreadable end is ignored", () => {
    renderAnnouncements([{ id: "n", kind: "info", endsAt: "next tuesday" }]);
    screen.getByText(/This end time can't be read\..*the end is ignored/);
  });

  it("says nothing about a sound window", () => {
    renderAnnouncements([{ id: "ok", kind: "maintenance", apps: ["nas"], startsAt: iso(now), endsAt: iso(now + HOUR) }]);
    expect(screen.queryByText(/ends before it starts|can't be read/)).toBeNull();
  });
});
