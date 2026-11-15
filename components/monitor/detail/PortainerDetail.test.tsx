import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortainerContainer, PortainerSnapshot } from "@/lib/services/portainer";
import { ConfirmProvider } from "@/components/admin/Confirm";
import PortainerDetail from "./PortainerDetail";

// #463: a slow reply landed whenever it arrived, so one environment's late
// container list filled another's row (and its buttons then acted on the
// wrong environment), and a slow log tail filled another container's modal.

const env = (id: number, name: string) => ({
  id, name, running: 1, stopped: 0, unhealthy: 0, total: 1, hasSnapshot: true,
});

const data: PortainerSnapshot = {
  endpoints: [env(1, "slow-env"), env(2, "fast-env")],
  totals: { running: 2, stopped: 0, unhealthy: 0, total: 2 },
};

// The page with actions on, as the drill-down needs. It opens the first
// environment by itself (#234), so slow-env's list is already on its way.
const mount = () =>
  render(
    <ConfirmProvider>
      <PortainerDetail data={data} actionsAllowed />
    </ConfirmProvider>
  );
const opened = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).getAttribute("aria-expanded");

const box = (name: string): PortainerContainer => ({
  id: name, name, state: "running", status: "Up 2 hours",
});

// Each request waits until the test answers it, by a key from its URL.
function deferredFetch() {
  const pending = new Map<string, (body: unknown) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const q = new URL(url, "http://x").searchParams;
      const key = q.get("container") ?? `endpoint ${q.get("endpoint")}`;
      return new Promise<Response>((resolve) =>
        pending.set(key, (body) => resolve(Response.json(body)))
      );
    })
  );
  return async (key: string, body: unknown) => {
    await act(async () => pending.get(key)!(body));
  };
}

describe("PortainerDetail (#514)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't show a late list under the environment opened since", async () => {
    const user = userEvent.setup();
    const answer = deferredFetch();
    mount();
    await vi.waitFor(() => expect(opened("slow-env")).toBe("true"));
    await user.click(screen.getByRole("button", { name: /^fast-env/ }));
    await answer("endpoint 2", { containers: [box("fast-app")] });
    await answer("endpoint 1", { containers: [box("slow-app")] });
    expect(screen.getByText("fast-app")).toBeTruthy();
    expect(screen.queryByText("slow-app")).toBeNull();
  });

  it("doesn't show a late log tail in another container's modal", async () => {
    const user = userEvent.setup();
    const answer = deferredFetch();
    mount();
    await vi.waitFor(() => expect(opened("slow-env")).toBe("true"));
    await user.click(screen.getByRole("button", { name: /^fast-env/ }));
    await answer("endpoint 2", { containers: [box("app-a"), box("app-b")] });
    const logsOf = (name: string) =>
      within(screen.getByText(name).closest("li")!).getByRole("button", { name: `Logs for ${name}` });
    await user.click(logsOf("app-a"));
    await user.keyboard("{Escape}");
    await user.click(logsOf("app-b"));
    await answer("app-b", { logs: "b says hello" });
    await answer("app-a", { logs: "a says hello" });
    const modal = screen.getByRole("dialog", { name: "Logs — app-b" });
    expect(within(modal).getByText(/b says hello/)).toBeTruthy();
    expect(within(modal).queryByText(/a says hello/)).toBeNull();
  });
});
