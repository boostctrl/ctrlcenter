import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { DetailResult } from "@/lib/monitor-detail";
import type { NavPages } from "@/lib/nav";
import MonitorDetail from "./MonitorDetail";

// An integration's page shell (#508): its header, the full-page state when
// it can't be reached, and a failed refresh keeping what was shown.
vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));
// The logo decodes its image after mount, which jsdom can't.
vi.mock("@/components/Icon", () => ({ default: () => null }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => "/admin/monitor/sonarr",
}));

const nav: NavPages = { boards: [], weather: false, status: false, calendar: false, member: false, visitor: false, admin: true };
const sonarr = (over: Partial<DetailResult> = {}) =>
  ({
    id: "sonarr-4k",
    service: "sonarr",
    label: "Sonarr 4K",
    actionsAllowed: false,
    openUrl: "http://sonarr.lan:8989",
    data: {
      upcoming: [],
      recent: [],
      health: [],
      queue: [],
      queueTotal: 0,
      missing: [],
      missingTotal: 0,
      disks: [],
      links: { home: "http://sonarr.lan:8989", queue: "", missing: "" },
    },
    error: null,
    ...over,
  }) as DetailResult;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MonitorDetail", () => {
  it("heads the page with the name, what the service is, and the way back", () => {
    render(<MonitorDetail initial={sonarr()} nav={nav} />);
    expect(screen.getByRole("heading", { level: 1, name: "Sonarr 4K" })).toBeDefined();
    expect(screen.getByText("Sonarr · TV series")).toBeDefined();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.querySelector('a[href="/admin/monitor"]')?.textContent).toBe("Monitor");
  });

  it("fills the page with the offline state when the service can't be reached", () => {
    render(<MonitorDetail initial={sonarr({ data: null, error: "Couldn't connect" })} nav={nav} />);
    expect(screen.getByRole("heading", { level: 2, name: "Can’t reach Sonarr 4K" })).toBeDefined();
    expect(screen.getByText("Couldn't connect")).toBeDefined();
    expect(screen.getByRole("link", { name: "Check the settings" }).getAttribute("href")).toMatch(
      /^\/admin\?tab=settings&section=integrations#/
    );
  });

  it("keeps showing the last data, marked stale, when a refresh fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(sonarr({ data: null, error: "Couldn't connect" })))
    );
    render(<MonitorDetail initial={sonarr()} nav={nav} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("status").textContent).toMatch(/^Couldn’t refresh.*Couldn't connect$/);
    expect(screen.getByRole("region", { name: "Coming up" })).toBeDefined();
    expect(screen.queryByText("Can’t reach Sonarr 4K")).toBeNull();
  });
});
