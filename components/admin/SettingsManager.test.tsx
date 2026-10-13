import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configSchema, integrationSchema, type Integration } from "@/lib/schema";

vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));
// The Security section's Sessions card holds a router (to sign out).
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));

const { default: AdminDashboard } = await import("./AdminDashboard");

// Settings keeps one live copy of whether two-factor authentication is on
// (#384): the sections unmount on every switch, so the Security card used to
// come back with the page-load value, and Integrations kept the actions
// opt-in (#367) locked until a reload.
const config = configSchema.parse({});
const qb = (patch: Partial<Integration> = {}) =>
  integrationSchema.parse({ id: "qb", type: "qbittorrent", url: "http://q", username: "u", password: "p", ...patch });

// The integration lists the autosave sent, oldest first.
let integrationSaves: Integration[][];

function renderSettings(twoFactorEnabled: boolean, integrations: Integration[]) {
  return render(
    <AdminDashboard
      initialApps={[]}
      initialBookmarks={[]}
      initialSettings={config.settings}
      initialWidgets={config.widgets}
      initialBoards={config.boards}
      initialGroups={[]}
      initialIntegrations={integrations}
      initialThemes={[]}
      initialTwoFactorEnabled={twoFactorEnabled}
      initialTab="settings"
      initialSection="security"
    />
  );
}

const section = (name: string) =>
  within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", { name });
const actionsSwitch = () =>
  screen.getByRole<HTMLInputElement>("switch", { name: "Allow actions from the dashboard" });

describe("Settings and two-factor authentication (#384)", () => {
  beforeEach(() => {
    integrationSaves = [];
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
        if (url === "/api/security") return Response.json({ rows: [] });
        if (url === "/api/security/events") return Response.json({ events: [] });
        if (url === "/api/sessions") return Response.json({ sessions: [], idleHours: 12 });
        if (url === "/api/2fa/setup") return Response.json({ secret: "JBSWY3DPEHPK3PXP", qr: "data:image/png;base64," });
        if (url === "/api/2fa/activate") return Response.json({ ok: true, recoveryCodes: ["aaaa-bbbb"] });
        if (url === "/api/2fa/disable") return Response.json({ ok: true, actionsDisabled: 1 });
        if (url === "/api/integrations") integrationSaves.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("unlocks the actions opt-in once it's on, and Security still shows it on after a switch", async () => {
    const user = userEvent.setup();
    renderSettings(false, [qb()]);
    await user.click(screen.getByRole("button", { name: "Enable" }));
    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Activate" }));
    await user.click(await screen.findByRole("button", { name: "I've saved my recovery codes" }));

    await user.click(section("Integrations"));
    expect(actionsSwitch().disabled).toBe(false);
    expect(screen.queryByText(/Needs two-factor authentication/)).toBeNull();

    await user.click(section("Security"));
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    screen.getByRole("button", { name: "Disable" });
    screen.getByText(/^On — a code from your authenticator app/);
  });

  it("clears the actions opt-in from the draft when it's turned off, so a later save doesn't send it back", async () => {
    const user = userEvent.setup();
    renderSettings(true, [qb({ allowActions: true })]);
    await user.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = screen.getByRole("dialog", { name: "Two-factor authentication" });
    await user.type(within(dialog).getByLabelText("Authentication code"), "123456");
    await user.click(within(dialog).getByRole("button", { name: "Disable" }));
    await screen.findByRole("button", { name: "Enable" });

    // The cleared draft goes out with actions off — no step-up, since turning
    // them off never needs one (app/api/integrations).
    await waitFor(() => expect(integrationSaves).toHaveLength(1), { timeout: 2000 });
    expect(integrationSaves[0][0].allowActions).toBe(false);

    await user.click(section("Integrations"));
    expect(actionsSwitch().disabled).toBe(true);
    expect(actionsSwitch().checked).toBe(false);
    screen.getByText(/Needs two-factor authentication/);
    // An unrelated edit afterwards still sends actions off.
    await user.type(screen.getByLabelText("Name"), "Seedbox");
    await waitFor(() => expect(integrationSaves).toHaveLength(2), { timeout: 2000 });
    expect(integrationSaves[1][0]).toMatchObject({ name: "Seedbox", allowActions: false });
  });
});
