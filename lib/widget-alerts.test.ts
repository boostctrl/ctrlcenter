import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configSchema, newInstance, type Board, type InstanceOf } from "./schema";
import type { ApiHeadline } from "./api-widget";
import { alertStateSaved, resetAlertState } from "./alert-state";
import {
  checkWidgetAlerts,
  evaluateThresholds,
  resetCountedReadings,
  thresholdDetail,
  widgetSubject,
  type ThresholdState,
} from "./widget-alerts";

// Alerts from the API widgets' thresholds (#539).
vi.mock("./log", () => ({ log: { warn: vi.fn(), info: vi.fn() }, errorReason: (e: unknown) => String(e) }));
vi.mock("./config", () => ({ readConfigInternal: vi.fn() }));
vi.mock("./api-widget", async (original) => ({
  ...(await original<typeof import("./api-widget")>()),
  getApiHeadline: vi.fn(),
}));
vi.mock("./alerts", async (original) => ({
  ...(await original<typeof import("./alerts")>()),
  dispatchAlerts: vi.fn(async () => {}),
}));

type Api = InstanceOf<"api">;
const widget = (over: Partial<Api> = {}): Api => ({
  ...newInstance("api", "pool"),
  url: "http://nas.lan/api",
  title: "Pool used",
  fields: [{ label: "Used", path: "$.used", unit: "%" }],
  thresholds: { warn: 80, critical: 90, direction: "above" },
  alerts: true,
  ...over,
});

describe("evaluateThresholds", () => {
  const run = (levels: ("ok" | "warn" | "critical")[], confirmations = 2, start = new Map<string, ThresholdState>()) => {
    let state = start;
    const types: string[][] = [];
    for (const level of levels) {
      const { next, events } = evaluateThresholds(state, [{ id: "w", level }], confirmations);
      state = next;
      types.push(events.map((e) => e.type));
    }
    return { state, types };
  };

  it("goes past a threshold after the confirmations, and comes back at once", () => {
    expect(run(["warn", "warn", "warn", "ok"]).types).toEqual([[], ["warning"], [], ["cleared"]]);
    expect(run(["critical", "critical", "ok"]).types).toEqual([[], ["down"], ["up"]]);
    // One blip stays quiet, as one failed check does.
    expect(run(["critical", "ok", "critical", "ok"]).types).toEqual([[], [], [], []]);
    expect(run(["warn"], 1).types).toEqual([["warning"]]);
  });

  it("moves between warn and critical", () => {
    // Past warn, then past critical: a down alert; back to warn: a recovery
    // (critical is over), then a cleared warning.
    expect(run(["warn", "warn", "critical", "critical", "warn", "ok"]).types).toEqual([
      [],
      ["warning"],
      [],
      ["down"],
      ["up"],
      ["cleared"],
    ]);
    // Readings past warn and past critical in turn confirm the warning.
    expect(run(["critical", "warn"]).types).toEqual([[], ["warning"]]);
  });

  it("keeps an entry only while something is past a threshold, its streaks capped", () => {
    expect(run(["warn", "warn", "warn", "warn"]).state.get("w")).toEqual({
      level: "warn",
      warnStreak: 2,
      criticalStreak: 0,
    });
    expect(run(["warn", "ok"]).state.has("w")).toBe(false);
    expect(run(["warn", "warn", "ok"]).state.has("w")).toBe(false);
  });

  it("stays confirmed when the confirmations are raised", () => {
    const critical = new Map([["w", { level: "critical" as const, warnStreak: 2, criticalStreak: 2 }]]);
    expect(run(["critical", "critical"], 5, critical).types).toEqual([[], []]);
  });
});

describe("thresholdDetail", () => {
  const t = { warn: 80, critical: 90.5, direction: "above" as const };
  const reading = { text: "92 %" };
  it("says where the number stands", () => {
    expect(thresholdDetail("down", reading, t)).toBe("92 % (critical ≥ 90.5)");
    expect(thresholdDetail("warning", { text: "84 %" }, t)).toBe("84 % (warn ≥ 80)");
    expect(thresholdDetail("up", { text: "75 %" }, t)).toBe("75 %, back under 90.5");
    expect(thresholdDetail("cleared", { text: "75 %" }, t)).toBe("75 %, back under 80");
    const below = { warn: 20, critical: 10, direction: "below" as const };
    expect(thresholdDetail("down", { text: "5 GB" }, below)).toBe("5 GB (critical ≤ 10)");
    expect(thresholdDetail("up", { text: "25 GB" }, below)).toBe("25 GB, back above 10");
    // A threshold removed meanwhile leaves the number.
    expect(thresholdDetail("up", { text: "75 %" }, { ...t, critical: null })).toBe("75 %");
  });
});

describe("widgetSubject", () => {
  const board = (id: string, name: string, sections: { widget: string; hidden?: boolean }[]): Board =>
    configSchema.parse({ boards: [{ id, name, layout: { sections } }] }).boards[0];
  const home = board("home", "Home", [{ widget: "other" }]);
  const infra = board("infra", "Infra", [{ widget: "pool" }]);
  const ctx = (boards: Board[], siteUrl = "https://home.example/") => ({ boards, labels: { pool: "API" }, siteUrl });

  it("names the widget on the board that shows it, linked there", () => {
    expect(widgetSubject(widget(), ctx([home, infra]))).toEqual({
      kind: "widget",
      id: "pool",
      name: "Pool used on Infra",
      url: "https://home.example/b/infra",
    });
    // The first board is the home page.
    expect(widgetSubject(widget(), ctx([infra, home])).url).toBe("https://home.example/");
    // A board where it's hidden counts only when no board shows it.
    const hidden = board("lab", "Lab", [{ widget: "pool", hidden: true }]);
    expect(widgetSubject(widget(), ctx([home, hidden, infra])).name).toBe("Pool used on Infra");
    expect(widgetSubject(widget(), ctx([home, hidden])).name).toBe("Pool used on Lab");
  });

  it("falls back to the field's label, has no link without a site address, and no board when on none", () => {
    expect(widgetSubject(widget({ title: " " }), ctx([home, infra], "")).name).toBe("Used on Infra");
    expect(widgetSubject(widget(), ctx([home, infra], "")).url).toBe("");
    expect(widgetSubject(widget({ title: "", fields: [] }), ctx([home]))).toEqual({
      kind: "widget",
      id: "pool",
      name: "API",
      url: "",
    });
  });
});

describe("checkWidgetAlerts", () => {
  let dir: string;
  let headline: ApiHeadline | null;
  let widgets: Api[];
  let enabled: boolean;

  const config = () =>
    configSchema.parse({
      settings: {
        siteUrl: "https://home.example",
        alerts: { enabled, confirmations: 2, channels: [{ id: "c", type: "webhook", url: "https://hook" }] },
      },
      boards: [{ id: "home", name: "Home", layout: { sections: [{ widget: "pool" }] } }],
      widgets,
    });
  const reading = (value: number, at: number): ApiHeadline => ({ value, at, text: `${value} %` });
  const sent = async () => {
    const { dispatchAlerts } = await import("./alerts");
    const calls = vi.mocked(dispatchAlerts).mock.calls;
    const all = calls.flatMap((c) => c[1]);
    vi.mocked(dispatchAlerts).mockClear();
    return all;
  };
  // A new process: the counted readings and the memory gone, the file kept.
  const restart = async () => {
    await alertStateSaved();
    resetAlertState();
    resetCountedReadings();
  };

  beforeEach(async () => {
    resetAlertState();
    resetCountedReadings();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-widget-alerts-"));
    vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
    headline = null;
    widgets = [widget()];
    enabled = true;
    const { readConfigInternal } = await import("./config");
    vi.mocked(readConfigInternal).mockImplementation(async () => config());
    const { getApiHeadline } = await import("./api-widget");
    vi.mocked(getApiHeadline).mockImplementation(async () => headline);
    await sent();
  });
  afterEach(async () => {
    await alertStateSaved();
    resetAlertState();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("counts new readings, not runs of the check", async () => {
    headline = reading(95, 1);
    await checkWidgetAlerts();
    // The same cached reading, read again, confirms nothing.
    await checkWidgetAlerts();
    await checkWidgetAlerts();
    expect(await sent()).toEqual([]);
    headline = reading(95, 2);
    await checkWidgetAlerts();
    expect(await sent()).toEqual([
      {
        event: { id: "pool", type: "down", detail: "95 % (critical ≥ 90)" },
        subject: { kind: "widget", id: "pool", name: "Pool used on Home", url: "https://home.example/" },
      },
    ]);
    headline = reading(70, 3);
    await checkWidgetAlerts();
    expect((await sent()).map((a) => [a.event.type, a.event.detail])).toEqual([["up", "70 %, back under 90"]]);
  });

  it("leaves the state as it was through a failed fetch", async () => {
    headline = reading(95, 1);
    await checkWidgetAlerts();
    headline = null;
    await checkWidgetAlerts();
    headline = reading(95, 2);
    await checkWidgetAlerts();
    expect((await sent()).map((a) => a.event.type)).toEqual(["down"]);
  });

  it("doesn't announce a crossing again after a restart, and still sends the recovery", async () => {
    headline = reading(85, 1);
    await checkWidgetAlerts();
    headline = reading(85, 2);
    await checkWidgetAlerts();
    expect((await sent()).map((a) => a.event.type)).toEqual(["warning"]);
    await restart();
    // The cache starts empty too, so the reading after a restart is new.
    headline = reading(85, 3);
    await checkWidgetAlerts();
    expect(await sent()).toEqual([]);
    headline = reading(60, 4);
    await checkWidgetAlerts();
    expect((await sent()).map((a) => a.event.type)).toEqual(["cleared"]);
    await alertStateSaved();
    expect(fs.existsSync(path.join(dir, "alert-state.json"))).toBe(false);
  });

  it("forgets a widget whose switch is turned off, quietly", async () => {
    headline = reading(95, 1);
    await checkWidgetAlerts();
    headline = reading(95, 2);
    await checkWidgetAlerts();
    await sent();
    widgets = [widget({ alerts: false })];
    await checkWidgetAlerts();
    widgets = [widget()];
    headline = reading(95, 3);
    await checkWidgetAlerts();
    // Switched back on, it starts over: one reading isn't a crossing yet.
    expect(await sent()).toEqual([]);
  });

  it("reads nothing while alerts are off", async () => {
    enabled = false;
    headline = reading(95, 1);
    await checkWidgetAlerts();
    const { getApiHeadline } = await import("./api-widget");
    expect(vi.mocked(getApiHeadline)).not.toHaveBeenCalled();
  });
});
