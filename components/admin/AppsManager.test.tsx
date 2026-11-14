import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { appItemSchema, type AppItem } from "@/lib/schema";
import { ToastProvider } from "./Toast";
import { useItems } from "./useAdminData";
import { useGroups } from "./useGroups";

vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));

const { default: AppsManager } = await import("./AppsManager");

function Harness({ apps = [] }: { apps?: AppItem[] }) {
  const items = useItems(apps, []);
  const groupsState = useGroups([]);
  return (
    <AppsManager items={items} groupsState={groupsState} statusChecksEnabled statusInterval={5} />
  );
}

function stubResizeObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

describe("AppsManager", () => {
  afterEach(() => vi.unstubAllGlobals());

  // #495: the panel's open state was worked out from the fields on every
  // render, so clearing the last override snapped it shut under the cursor.
  it("keeps Advanced check settings open while its fields are cleared", async () => {
    const user = userEvent.setup();
    stubResizeObserver();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const app = appItemSchema.parse({ id: "a", name: "Plex", url: "https://plex.example.com", interval: 5 });
    render(
      <ToastProvider>
        <Harness apps={[app]} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const panel = screen.getByText("Advanced check settings").closest("details")!;
    expect(panel.open).toBe(true);
    await user.clear(screen.getByLabelText(/^Interval/));
    expect(panel.open).toBe(true);

    // Opened by hand on an app without overrides, it stays open as well.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(panel.open).toBe(false);
    await user.click(screen.getByText("Advanced check settings"));
    expect(panel.open).toBe(true);
    await user.type(screen.getByLabelText(/^Retries/), "2");
    await user.clear(screen.getByLabelText(/^Retries/));
    expect(panel.open).toBe(true);
  });

  // #473: after adding a push-check app under a new group, the form stays
  // open for the push URL, and its Group field showed the new group's id
  // because the group list hadn't refreshed yet. Saving again then created
  // a group named after that id.
  it("keeps a new group's typed name on a just-added push app", async () => {
    const user = userEvent.setup();
    stubResizeObserver();
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
