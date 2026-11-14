import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "./Toast";
import { useItems } from "./useAdminData";
import { useGroups } from "./useGroups";

vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));

const { default: AppsManager } = await import("./AppsManager");

function Harness() {
  const items = useItems([], []);
  const groupsState = useGroups([]);
  return (
    <AppsManager items={items} groupsState={groupsState} statusChecksEnabled statusInterval={5} />
  );
}

describe("AppsManager", () => {
  afterEach(() => vi.unstubAllGlobals());

  // #473: after adding a push-check app under a new group, the form stays
  // open for the push URL, and its Group field showed the new group's id
  // because the group list hadn't refreshed yet. Saving again then created
  // a group named after that id.
  it("keeps a new group's typed name on a just-added push app", async () => {
    const user = userEvent.setup();
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
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/apps" && init?.method === "POST") {
          const sent = JSON.parse(String(init.body));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ...sent,
                id: "a1",
                group: "g_abc123",
                tags: [],
                pushToken: "tok123",
              }),
              { status: 200 }
            )
          );
        }
        // The group list's refresh hasn't come back yet.
        return new Promise<Response>(() => {});
      })
    );
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );
    await user.type(screen.getByLabelText("Name"), "Nightly backup");
    await user.type(screen.getByLabelText(/^URL/), "https://backup.example.com");
    await user.type(screen.getByLabelText(/^Group/), "Backups");
    await user.selectOptions(screen.getByLabelText(/^Check method/), "push");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Application added — copy its push URL below")).toBeTruthy();
    expect((screen.getByLabelText(/^Group/) as HTMLInputElement).value).toBe("Backups");
  });
});
