import { describe, it, expect } from "vitest";
import {
  alertChannels,
  channelReady,
  legacyChannels,
  missingFields,
  moveLegacyIntoChannels,
  wantsAlert,
} from "./alert-channels";
import { alertChannelSchema, alertsSchema } from "./schema";

const channel = (over: Record<string, unknown>) =>
  alertChannelSchema.parse({ id: "c", type: "webhook", ...over });

describe("legacyChannels", () => {
  it("is empty for a fresh config", () => {
    expect(legacyChannels(alertsSchema.parse({}))).toEqual([]);
  });

  it("turns the original webhook and email keys into entries", () => {
    const config = alertsSchema.parse({
      type: "ntfy",
      webhookUrl: "https://ntfy.test/x",
      webhookEnabled: false,
      notifyOnRecovery: false,
      email: { enabled: true, host: "smtp.test", from: "a@x", to: "b@y", subject: "S" },
    });
    const [webhook, email] = legacyChannels(config);
    expect(webhook).toMatchObject({
      id: "legacy-webhook",
      type: "webhook",
      enabled: false,
      format: "ntfy",
      url: "https://ntfy.test/x",
      onRecovery: false,
      apps: [],
    });
    expect(email).toMatchObject({
      id: "legacy-email",
      type: "email",
      enabled: true,
      smtp: { host: "smtp.test", from: "a@x", to: "b@y", subject: "S", port: 587 },
    });
  });

  it("lists them ahead of the channel list", () => {
    const config = alertsSchema.parse({
      webhookUrl: "https://x.test",
      channels: [channel({ id: "n", url: "https://n.test" })],
    });
    expect(alertChannels(config).map((c) => c.id)).toEqual(["legacy-webhook", "n"]);
  });
});

describe("moveLegacyIntoChannels", () => {
  it("moves the original keys into the list and resets them", () => {
    const config = alertsSchema.parse({
      webhookUrl: "https://x.test",
      type: "slack",
      email: { enabled: true, host: "smtp.test", from: "a@x", to: "b@y" },
      channels: [channel({ id: "n" })],
    });
    let n = 0;
    const patch = moveLegacyIntoChannels(config, () => `new-${++n}`);
    expect(patch.channels.map((c) => [c.id, c.type])).toEqual([
      ["new-1", "webhook"],
      ["new-2", "email"],
      ["n", "webhook"],
    ]);
    expect(patch.channels[0]).toMatchObject({ format: "slack", url: "https://x.test" });
    const after = alertsSchema.parse({ ...config, ...patch });
    expect(legacyChannels(after)).toEqual([]);
    expect(alertChannels(after)).toHaveLength(3);
  });
});

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

describe("alertChannelSchema", () => {
  it("drops an unknown type from the stored list instead of failing", () => {
    const config = alertsSchema.parse({
      channels: [{ id: "x", type: "carrier-pigeon" }, { id: "y", type: "gotify" }],
    });
    expect(config.channels.map((c) => c.id)).toEqual(["y"]);
  });
});
