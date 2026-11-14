import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ServiceStatus } from "@/lib/monitor";
import type { UnifiDetail as UnifiDetailData } from "@/lib/services/unifi";
import UnifiDetail from "./UnifiDetail";

// #467: other UniFi apps' devices (Protect cameras and the like) join the
// list. They carry no client count or uptime, so their rows show neither.
const status: ServiceStatus<UnifiDetailData> = {
  configured: true,
  enabled: true,
  urlSet: true,
  actionsAllowed: false,
  data: {
    internet: { up: true, isp: null, wanIp: null, latencyMs: null },
    clients: { total: 20, wireless: 13, wired: 7, guests: 0 },
    devices: { online: 2, disconnected: 1, pending: 0 },
    issues: [],
    deviceList: [
      { name: "Porch", kind: "Protect", up: false, clients: null, uptime: null },
      { name: "Office AP", kind: "Access Point", up: true, clients: 12, uptime: 3600 },
      { name: "Driveway", kind: "Protect", up: true, clients: null, uptime: null },
    ],
  },
  error: null,
  at: 0,
};

describe("UnifiDetail", () => {
  it("shows clients and uptime for network gear only", () => {
    render(<UnifiDetail status={status} />);
    const row = (name: string) => screen.getByTitle(name).closest("li")!;
    expect(row("Office AP").textContent).toContain("12 clients");
    expect(row("Office AP").textContent).toContain("up 1h");
    expect(row("Driveway").textContent).toBe("DrivewayProtect");
    expect(row("Porch").textContent).toBe("PorchProtectoffline");
  });
});
