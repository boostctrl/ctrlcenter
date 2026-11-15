import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MonitorEntry, MonitorSnapshot } from "@/lib/monitor";
import type { NavPages } from "@/lib/nav";
import MonitorDashboard from "./MonitorDashboard";

// The Monitor dashboard (#509, #520): the command deck's ring, totals and
// problems, each linking to the page that shows it; every tile in one flow,
// ordered by group; and the types nobody has set up in one row at the end.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => "/admin/monitor",
}));

const nav: NavPages = { boards: [], weather: false, status: false, calendar: false, member: false, visitor: false, admin: true };
const base = { configured: true, enabled: true, urlSet: true, actionsAllowed: false, error: null, at: 0 };
const snapshot = [
  { ...base, id: "sonarr-4k", type: "sonarr", label: "Sonarr 4K", data: null, error: "Couldn't connect" },
  {
    ...base,
    id: "nas",
    type: "truenas",
    label: "TrueNAS",
    data: {
      pools: [{ name: "tank", healthy: false, usedRatio: 0.91, free: 2 * 1024 ** 4 }],
      apps: [],
      alerts: [{ level: "critical", message: "Pool tank is DEGRADED" }],
    },
  },
] as MonitorEntry[] as MonitorSnapshot;

describe("MonitorDashboard", () => {
  it("reads the whole system in the command deck: the ring, the totals and what needs attention", () => {
    render(<MonitorDashboard initial={snapshot} nav={nav} />);
    const health = screen.getByRole("region", { name: "System health" });
    expect(within(health).getByRole("heading", { name: "Attention needed" })).toBeDefined();
    // One arc per integration; the one that answers counts as online.
    expect(within(health).getByRole("img", { name: "1 of 2 services answering" })).toBeDefined();
    const links = within(health).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      // The totals, for the types that answered.
      ["Storage2.0 TB freeFullest pool 91%", "/admin/monitor/nas"],
      // How bad each is, in words for a screen reader as well as the icon's color.
      ["Critical: Pool tank is DEGRADEDTrueNAS", "/admin/monitor/nas"],
      ["Critical: Can't reach it: Couldn't connectSonarr 4K", "/admin/monitor/sonarr-4k"],
    ]);
  });

  it("lays every tile out in one flow, by group, and the rest as one row to set up", () => {
    render(<MonitorDashboard initial={snapshot} nav={nav} />);
    // Storage leads media, whatever order they were added in.
    const tiles = within(screen.getByRole("region", { name: "Services" })).getAllByRole("link");
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual(["/admin/monitor/nas", "/admin/monitor/sonarr-4k"]);
    const rest = screen.getByRole("region", { name: "Not set up yet" });
    expect(within(rest).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "+ qBittorrent",
      "+ Radarr",
      "+ AdGuard Home",
      "+ Tautulli",
      "+ Seerr",
      "+ Portainer",
      "+ UniFi",
    ]);
  });
});
