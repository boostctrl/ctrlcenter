import { describe, it, expect } from "vitest";
import { newInstance, type WidgetInstance } from "./schema";
import { alertChannelsChangeTarget, widgetsChangeTarget } from "./reauth-targets";

// Which saves re-point where a secret is sent, and so need a recent
// confirmation (#378).
const api = { ...newInstance("api", "api-1"), url: "http://nas.lan/stats", headers: [{ name: "Authorization", value: "Bearer ${NAS_TOKEN}" }] } as WidgetInstance;
const calendar = { ...newInstance("calendar", "cal-1"), url: "https://dav.lan/cal", username: "me", password: "pw" } as WidgetInstance;
const notes = { ...newInstance("notes", "notes-1"), content: "hi" } as WidgetInstance;

describe("widgetsChangeTarget", () => {
  const stored = [api, calendar, notes];

  it("passes edits that don't move a secret", () => {
    expect(widgetsChangeTarget(stored, stored)).toBe(false);
    expect(widgetsChangeTarget([{ ...api, title: "NAS", refresh: 120 } as WidgetInstance, calendar, notes], stored)).toBe(false);
    expect(widgetsChangeTarget([api, { ...calendar, count: 9 } as WidgetInstance, { ...notes, content: "bye" } as WidgetInstance], stored)).toBe(false);
    // Removing one never asks.
    expect(widgetsChangeTarget([notes], stored)).toBe(false);
  });

  it("flags an API widget's URL, method, headers or body", () => {
    for (const change of [
      { url: "https://evil.example/" },
      { method: "POST" },
      { headers: [{ name: "Authorization", value: "Bearer ${OTHER}" }] },
      { headers: [...(api as { headers: unknown[] }).headers, { name: "X-Leak", value: "${NAS_TOKEN}" }] },
      { body: "{}" },
    ]) {
      expect(widgetsChangeTarget([{ ...api, ...change } as WidgetInstance], stored)).toBe(true);
    }
  });

  it("flags a calendar's address or sign-in", () => {
    for (const change of [{ url: "https://evil.example/cal" }, { username: "you" }, { password: "x" }]) {
      expect(widgetsChangeTarget([{ ...calendar, ...change } as WidgetInstance], stored)).toBe(true);
    }
  });

  it("flags a new widget once it has a request or an address, not the palette's empty one", () => {
    expect(widgetsChangeTarget([...stored, newInstance("api", "api-2")], stored)).toBe(false);
    expect(widgetsChangeTarget([...stored, newInstance("calendar", "cal-2")], stored)).toBe(false);
    expect(widgetsChangeTarget([...stored, { ...newInstance("api", "api-2"), url: "http://x" } as WidgetInstance], stored)).toBe(true);
    expect(widgetsChangeTarget([...stored, { ...newInstance("calendar", "cal-2"), url: "http://x" } as WidgetInstance], stored)).toBe(true);
  });
});

describe("alertChannelsChangeTarget", () => {
  const mail = { id: "mail", type: "email" as const, smtp: { host: "smtp.lan" } };
  const hook = { id: "hook", type: "webhook" as const };

  it("passes edits that leave the SMTP server alone", () => {
    expect(alertChannelsChangeTarget([mail, hook], [mail, hook])).toBe(false);
    expect(alertChannelsChangeTarget([{ ...mail, smtp: { host: " smtp.lan " } }], [mail])).toBe(false);
    expect(alertChannelsChangeTarget([hook], [mail, hook])).toBe(false);
    // A new email channel with no server yet.
    expect(alertChannelsChangeTarget([mail, { id: "m2", type: "email", smtp: { host: "" } }], [mail])).toBe(false);
  });

  it("flags a new server, a new email channel with one, and a channel switched to email", () => {
    expect(alertChannelsChangeTarget([{ ...mail, smtp: { host: "evil.example" } }], [mail])).toBe(true);
    expect(alertChannelsChangeTarget([mail, { id: "m2", type: "email", smtp: { host: "x" } }], [mail])).toBe(true);
    expect(alertChannelsChangeTarget([{ ...hook, type: "email", smtp: { host: "x" } }], [hook])).toBe(true);
  });
});
