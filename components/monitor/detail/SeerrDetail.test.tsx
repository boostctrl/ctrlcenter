import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SeerrDetail as SeerrDetailData } from "@/lib/services/seerr";
import { ConfirmProvider } from "@/components/admin/Confirm";
import { MonitorIntegrationContext } from "../actions";
import SeerrDetail from "./SeerrDetail";

// Seerr's page (#511): what's waiting for approval, and Approve and Deny on
// it only when actions are on.
const data: SeerrDetailData = {
  pending: 1,
  processing: 2,
  available: 40,
  totalRequests: 52,
  waiting: [{ id: 7, title: "Dune: Part Two", requester: "Alex", type: "movie", status: "pending", at: null }],
  requests: [
    { id: 7, title: "Dune: Part Two", requester: "Alex", type: "movie", status: "pending", at: null },
    { id: 8, title: "Silo", requester: "Sam", type: "tv", status: "available", at: null },
  ],
};

afterEach(() => vi.unstubAllGlobals());

const mount = (actionsAllowed: boolean) =>
  render(
    <ConfirmProvider>
      <MonitorIntegrationContext.Provider value="seerr">
        <SeerrDetail data={data} actionsAllowed={actionsAllowed} onActed={() => {}} />
      </MonitorIntegrationContext.Provider>
    </ConfirmProvider>
  );

describe("SeerrDetail", () => {
  it("marks what's waiting as pending when actions are off", () => {
    mount(false);
    const waiting = screen.getByRole("region", { name: /Waiting for approval/ });
    expect(within(waiting).getByText("Pending")).toBeDefined();
    expect(within(waiting).queryByRole("button", { name: /^Approve/ })).toBeNull();
    const recent = screen.getByRole("region", { name: /Recent requests/ });
    // The waiting request isn't listed twice.
    expect(within(recent).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["SiloSeries · SamAvailable"]);
  });

  it("approves a waiting request when actions are on", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    mount(true);
    // Each button names its request, for a screen reader going button to
    // button (#518).
    fireEvent.click(screen.getByRole("button", { name: "Approve Dune: Part Two" }));
    // The page also fetches its history (#530); the approve is the action call.
    const action = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "/api/monitor/action");
    await waitFor(() => expect(action()).toBeDefined());
    const [url, init] = action()!;
    expect(url).toBe("/api/monitor/action");
    expect(JSON.parse(String(init.body))).toEqual({ service: "seerr", action: "approve", id: 7, integration: "seerr" });
  });
});
