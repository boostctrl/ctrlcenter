import { describe, it, expect } from "vitest";
import { channelReady, missingFields, subjectFilterKey, uniqueChannelLabels, wantsAlert } from "./alert-channels";
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
  const app = (id: string) => ({ kind: "app" as const, id });

  it("filters by event and by app", () => {
    const ch = channel({ onRecovery: false, apps: ["a"] });
    expect(wantsAlert(ch, "down", app("a"))).toBe(true);
    expect(wantsAlert(ch, "up", app("a"))).toBe(false);
    expect(wantsAlert(ch, "down", app("b"))).toBe(false);
    expect(wantsAlert(channel({}), "down", app("anything"))).toBe(true);
    // A cleared warning needs both the warning and the recovery switch.
    expect(wantsAlert(channel({}), "cleared", app("a"))).toBe(true);
    expect(wantsAlert(channel({ onRecovery: false }), "cleared", app("a"))).toBe(false);
    expect(wantsAlert(channel({ onWarning: false }), "warning", app("a"))).toBe(false);
  });

  // A filter someone narrowed to some apps keeps meaning just those, so the
  // kinds that come after apps (#559) reach it only when it names them.
  it("takes another kind of subject only when the filter is empty or names it", () => {
    const widget = { kind: "widget" as const, id: "a" };
    expect(wantsAlert(channel({}), "warning", widget)).toBe(true);
    expect(wantsAlert(channel({ apps: ["a"] }), "warning", widget)).toBe(false);
    expect(wantsAlert(channel({ apps: ["widget:a"] }), "warning", widget)).toBe(true);
    expect(wantsAlert(channel({ apps: ["widget:a"] }), "down", app("a"))).toBe(false);
    expect(wantsAlert(channel({ apps: ["integration:t"] }), "warning", { kind: "integration", id: "t" })).toBe(true);
  });
});

describe("subjectFilterKey", () => {
  it("names an app by its id, as filters always have, and anything else by kind and id", () => {
    expect(subjectFilterKey({ kind: "app", id: "plex" })).toBe("plex");
    expect(subjectFilterKey({ kind: "widget", id: "w1" })).toBe("widget:w1");
    expect(subjectFilterKey({ kind: "integration", id: "truenas" })).toBe("integration:truenas");
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
