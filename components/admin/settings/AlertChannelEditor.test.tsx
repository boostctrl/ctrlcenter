import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { alertsSchema, type AlertChannel } from "@/lib/schema";
import { AlertChannelEditor } from "./AlertChannelEditor";

// Each channel's Send test is named for the channel (#350), the way the
// preview's Send sample buttons are, so a screen reader can tell the
// channels' buttons apart; the visible label stays "Send test". Two unnamed
// channels of one type are told apart by position (#434).
const { channels } = alertsSchema.parse({
  channels: [
    { id: "chat", type: "webhook", name: "Chat", url: "https://hook.test" },
    { id: "tg", type: "telegram", token: "t", chatId: "1" },
    { id: "mail", type: "email", name: "  " },
    { id: "hook-a", type: "webhook", url: "https://a.test" },
    { id: "hook-b", type: "webhook", url: "https://b.test" },
  ],
});
const [chat, telegram, email, hookA, hookB] = channels;

const formatLabel = { generic: "Generic JSON webhook", discord: "Discord", slack: "Slack", ntfy: "ntfy" };
const urlPlaceholder = { generic: "", discord: "", slack: "", ntfy: "" };

function renderChannel(channel: AlertChannel, saving = false) {
  return render(
    <AlertChannelEditor
      channel={channel}
      channels={channels}
      apps={[]}
      saving={saving}
      formatLabel={formatLabel}
      urlPlaceholder={urlPlaceholder}
      onChange={() => {}}
      onRemove={() => {}}
    />
  );
}

describe("AlertChannelEditor's Send test (#350)", () => {
  it("is named for the channel, keeping its visible label", () => {
    renderChannel(chat);
    const button = screen.getByRole("button", { name: "Send test from Chat" });
    expect(button.textContent).toBe("Send test");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("falls back to the service's name, as the channel's heading does", () => {
    renderChannel(telegram);
    expect(screen.getByRole("button", { name: "Send test from Telegram" })).toBeTruthy();
    // The heading over the editor (the Service select lists Telegram too).
    expect(screen.getByText("Telegram", { selector: "span" })).toBeTruthy();
  });

  it("ignores a blank name and waits out a save", () => {
    renderChannel(email, true);
    const button = screen.getByRole("button", { name: "Send test from Email (SMTP)" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells two unnamed channels of one type apart by their place in the list (#434)", () => {
    renderChannel(hookA);
    renderChannel(hookB);
    const buttons = screen.getAllByRole("button", { name: /^Send test/ });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Send test from Webhook",
      "Send test from Webhook 2",
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual(["Send test", "Send test"]);
    // The second's other controls are told apart the same way, and so is
    // its visible heading (#442).
    expect(screen.getByRole("switch", { name: "Webhook 2 enabled" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Webhook 2" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Webhook 2: events" })).toBeTruthy();
    expect(screen.getAllByText(/^Webhook( 2)?$/, { selector: "span" }).map((s) => s.textContent)).toEqual([
      "Webhook",
      "Webhook 2",
    ]);
  });
});

// A channel's filter offers the API widgets (#539) and integrations (#540)
// that send alerts beside the apps, each named by its kind and id.
describe("AlertChannelEditor's filter", () => {
  const filter = (
    channel: AlertChannel,
    widgets?: { id: string; name: string }[],
    integrations?: { id: string; name: string }[]
  ) => {
    const onChange = vi.fn();
    render(
      <AlertChannelEditor
        channel={channel}
        channels={channels}
        apps={[{ id: "plex", name: "Plex" }]}
        widgets={widgets}
        integrations={integrations}
        saving={false}
        formatLabel={formatLabel}
        urlPlaceholder={urlPlaceholder}
        onChange={onChange}
        onRemove={() => {}}
      />
    );
    return onChange;
  };

  it("names only apps while no widget sends alerts", () => {
    filter({ ...chat, apps: ["plex"] });
    expect(screen.getByText("Apps")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pool used" })).toBeNull();
  });

  it("offers the widgets that send alerts, as widget:<id>", async () => {
    const onChange = filter({ ...chat, apps: ["plex"] }, [{ id: "pool", name: "Pool used" }]);
    expect(screen.getByText("Apps & widgets")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Pool used" }));
    expect(onChange).toHaveBeenLastCalledWith({ apps: ["plex", "widget:pool"] });
  });

  it("offers the integrations that send alerts, as integration:<id>", async () => {
    const onChange = filter({ ...chat, apps: ["plex"] }, undefined, [{ id: "nas", name: "NAS" }]);
    expect(screen.getByText("Apps & integrations")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "NAS" }));
    expect(onChange).toHaveBeenLastCalledWith({ apps: ["plex", "integration:nas"] });
  });

  it("names all three when widgets and integrations send alerts", () => {
    filter({ ...chat, apps: [] }, [{ id: "pool", name: "Pool used" }], [{ id: "nas", name: "NAS" }]);
    expect(screen.getByText("Apps, widgets & integrations")).toBeTruthy();
  });
});
