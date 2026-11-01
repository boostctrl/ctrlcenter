import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
    // The second's other controls are told apart the same way, while both
    // headings still read "Webhook".
    expect(screen.getByRole("switch", { name: "Webhook 2 enabled" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Webhook 2" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Webhook 2: events" })).toBeTruthy();
    expect(screen.getAllByText("Webhook", { selector: "span" })).toHaveLength(2);
  });
});
