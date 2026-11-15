import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MonitorEntry, MonitorSnapshot } from "@/lib/monitor";
import type { NavPages } from "@/lib/nav";
import MonitorDashboard from "./MonitorDashboard";

// The Monitor dashboard (#509): the health banner's problems link to the
// page that shows them, the tiles sit in their groups' grids, and the types
// nobody has set up share one row at the end.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => "/admin/monitor",
}));

const nav: NavPages = { boards: [], weather: false, status: false, calendar: false, member: false, visitor: false, admin: true };
const base = { configured: true, enabled: true, urlSet: true, actionsAllowed: false, error: null, at: 0 };
const snapshot = [
  {
    ...base,
    id: "nas",
    type: "truenas",
    label: "TrueNAS",
    data: { pools: [], apps: [], alerts: [{ level: "critical", message: "Pool tank is DEGRADED" }] },
  },
  { ...base, id: "sonarr-4k", type: "sonarr", label: "Sonarr 4K", data: null, error: "Couldn't connect" },
] as MonitorEntry[] as MonitorSnapshot;

describe("MonitorDashboard", () => {
  it("lists what needs attention, each linking to its page", () => {
    render(<MonitorDashboard initial={snapshot} nav={nav} />);
    const health = screen.getByRole("region", { name: "System health" });
    expect(within(health).getByRole("heading", { name: "Attention needed" })).toBeDefined();
    const links = within(health).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      // How bad each is, in words for a screen reader as well as the icon's color.
      ["Critical: Pool tank is DEGRADEDTrueNAS", "/admin/monitor/nas"],
      ["Critical: Can't reach it: Couldn't connectSonarr 4K", "/admin/monitor/sonarr-4k"],
    ]);
  });

  it("shows only the groups with something in them, and the rest as one row to set up", () => {
    render(<MonitorDashboard initial={snapshot} nav={nav} />);
    expect(screen.getByRole("heading", { name: "Storage & Containers" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Media" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Network" })).toBeNull();
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
