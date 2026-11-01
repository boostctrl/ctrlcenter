import { describe, it, expect } from "vitest";
import { channelReady, missingFields, uniqueChannelLabels, wantsAlert } from "./alert-channels";
import { alertChannelSchema, alertsSchema } from "./schema";

const channel = (over: Record<string, unknown>) =>
  alertChannelSchema.parse({ id: "c", type: "webhook", ...over });

describe("missingFields / channelReady", () => {
  it("names what each type still needs", () => {
    expect(missingFields(channel({}))).toEqual(["a webhook URL"]);
    expect(missingFields(channel({ type: "telegram", token: "t" }))).toEqual(["a chat ID"]);
    expect(missingFields(channel({ type: "gotify", url: "https://g" }))).toEqual(["an app token"]);
    expect(missingFields(channel({ type: "pushover", token: "t", userKey: "u" }))).toEqual([]);
    expect(missingFields(channel({ type: "apprise", url: "  " }))).toEqual(["an Apprise URL"]);
    expect(missingFields(channel({ type: "email", smtp: { host: "h" } }))).toEqual([
      "a from address",
      "a to address",
    ]);
  });

  it("is ready once nothing is missing", () => {
    expect(channelReady(channel({ url: "https://x" }))).toBe(true);
    expect(channelReady(channel({ type: "telegram" }))).toBe(false);
  });
});

describe("wantsAlert", () => {
  it("filters by event and by app", () => {
    const ch = channel({ onRecovery: false, apps: ["a"] });
    expect(wantsAlert(ch, "down", "a")).toBe(true);
    expect(wantsAlert(ch, "up", "a")).toBe(false);
    expect(wantsAlert(ch, "down", "b")).toBe(false);
    expect(wantsAlert(channel({}), "down", "anything")).toBe(true);
    // A cleared warning needs both the warning and the recovery switch.
    expect(wantsAlert(channel({}), "cleared", "a")).toBe(true);
    expect(wantsAlert(channel({ onRecovery: false }), "cleared", "a")).toBe(false);
    expect(wantsAlert(channel({ onWarning: false }), "warning", "a")).toBe(false);
  });
});

describe("uniqueChannelLabels (#434)", () => {
  const labels = (list: Record<string, unknown>[]) =>
    uniqueChannelLabels(alertsSchema.parse({ channels: list }).channels);

  it("numbers namesakes by position, by id, and leaves every other label alone", () => {
    const named = labels([
      { id: "a", type: "webhook" },
      { id: "b", type: "webhook", name: "Chat" },
      { id: "c", type: "webhook" },
      { id: "d", type: "telegram" },
      { id: "e", type: "webhook", name: "  " },
      { id: "f", type: "gotify", name: "Chat" },
    ]);
    expect([...named.values()]).toEqual(["Webhook", "Chat", "Webhook 2", "Telegram", "Webhook 3", "Chat 2"]);
    expect(named.get("e")).toBe("Webhook 3");
    expect(labels([]).size).toBe(0);
  });

  it("skips a number a channel already carries by name", () => {
    const named = labels([
      { id: "a", type: "webhook" },
      { id: "b", type: "webhook", name: "Webhook 2" },
      { id: "c", type: "webhook" },
    ]);
    expect([...named.values()]).toEqual(["Webhook", "Webhook 2", "Webhook 3"]);
  });
});

describe("alertChannelSchema", () => {
  it("drops an unknown type from the stored list instead of failing", () => {
    const config = alertsSchema.parse({
      channels: [{ id: "x", type: "carrier-pigeon" }, { id: "y", type: "gotify" }],
    });
    expect(config.channels.map((c) => c.id)).toEqual(["y"]);
  });
});
