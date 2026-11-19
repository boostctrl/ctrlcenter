import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configSchema, integrationsUpdateSchema } from "./schema";
import { SERVICE_IDS, SERVICE_META, alertConditionsOn } from "./services/ids";
import type { MonitorEntry } from "./monitor";
import type { TruenasSnapshot } from "./services/truenas";
import { alertStateSaved, resetAlertState } from "./alert-state";
import {
  CONDITION_READERS,
  checkIntegrationAlerts,
  evaluateHealth,
  resetCountedSnapshots,
  type ConditionReading,
  type HealthState,
  type ItemReading,
} from "./integration-alerts";

// Alerts from the integrations' health (#540).
vi.mock("./log", () => ({ log: { warn: vi.fn(), info: vi.fn() }, errorReason: (e: unknown) => String(e) }));
vi.mock("./alerts", async (original) => ({
  ...(await original<typeof import("./alerts")>()),
  dispatchAlerts: vi.fn(async () => {}),
}));

describe("the conditions", () => {
  it("has a reader for every switch a type offers, and no reader without one", () => {
    for (const type of SERVICE_IDS) {
      const offered = (SERVICE_META[type].alertConditions ?? []).map((c) => c.id).sort();
      expect(Object.keys(CONDITION_READERS[type] ?? {}).sort(), type).toEqual(offered);
    }
  });

  it("are on only when listed, known to the type, and the integration is on with an address", () => {
    const nas = { type: "truenas" as const, enabled: true, url: "https://nas" };
    expect(alertConditionsOn({ ...nas, alertOn: ["app", "pool", "nonsense"] })).toEqual(["pool", "app"]);
    expect(alertConditionsOn(nas)).toEqual([]);
    expect(alertConditionsOn({ ...nas, enabled: false, alertOn: ["pool"] })).toEqual([]);
    expect(alertConditionsOn({ ...nas, url: " ", alertOn: ["pool"] })).toEqual([]);
    expect(alertConditionsOn({ type: "sonarr", enabled: true, url: "http://s", alertOn: ["pool"] })).toEqual([]);
  });

  it("are stored only when some are on, and an integration saved without them still saves", () => {
    const row = { id: "nas", type: "truenas", url: "https://nas" };
    const [stored] = configSchema.parse({ integrations: [row] }).integrations;
    expect("alertOn" in stored).toBe(false);
    expect(integrationsUpdateSchema.safeParse([stored]).success).toBe(true);
    expect(integrationsUpdateSchema.safeParse([{ ...stored, alertOn: ["pool"] }]).success).toBe(true);
    expect(integrationsUpdateSchema.safeParse([{ ...stored, alertOn: "pool" }]).success).toBe(false);
  });
});

describe("TrueNAS's conditions", () => {
  const snap = (over: Partial<TruenasSnapshot> = {}): TruenasSnapshot => ({ pools: [], apps: [], alerts: [], ...over });
  const items = (r: ConditionReading | null) => Object.fromEntries(r?.items ?? []);
  const app = (name: string, state: string) => ({
    name,
    state,
    running: state === "RUNNING",
    upgradeAvailable: false,
    containers: 1,
    containerList: [],
  });

  it("reads each pool", () => {
    const pool = (name: string, status: string, healthy: boolean) => ({ name, status, healthy, usedRatio: null, free: null });
    const r = CONDITION_READERS.truenas!.pool(
      snap({ pools: [pool("tank", "ONLINE", true), pool("backup", "DEGRADED", false), pool("odd", "ONLINE", false)] })
    );
    expect(items(r)).toEqual({
      tank: { bad: false, text: "pool tank is healthy again" },
      backup: { bad: true, text: "pool backup is DEGRADED" },
      odd: { bad: true, text: "pool odd isn't healthy" },
    });
    expect(r?.gone).toBeNull();
  });

  it("reads TrueNAS's alerts by their ids, one gone as resolved", () => {
    const r = CONDITION_READERS.truenas!.alert(snap({ alerts: [{ id: "u1", level: "warning", message: "Disk sda is failing" }] }));
    expect(items(r)).toEqual({ u1: { bad: true, text: "Disk sda is failing" } });
    expect(r?.gone?.("Disk sda is failing")).toBe("resolved: Disk sda is failing");
    // A list that couldn't be read is no reading.
    expect(CONDITION_READERS.truenas!.alert(snap({ unread: ["alerts"] }))).toBeNull();
  });

  it("reads each app, one deploying as neither", () => {
    const r = CONDITION_READERS.truenas!.app(
      snap({ apps: [app("plex", "RUNNING"), app("immich", "CRASHED"), app("sonarr", "STOPPED"), app("radarr", "DEPLOYING")] })
    );
    expect(items(r)).toEqual({
      plex: { bad: false, text: "app plex is running again" },
      immich: { bad: true, text: "app immich crashed" },
      sonarr: { bad: true, text: "app sonarr stopped" },
      radarr: "hold",
    });
    expect(CONDITION_READERS.truenas!.app(snap({ unread: ["apps"] }))).toBeNull();
    expect(CONDITION_READERS.truenas!.app(snap({ unread: ["alerts"] }))).not.toBeNull();
  });
});

describe("evaluateHealth", () => {
  type Step = Record<string, ItemReading>;
  const run = (steps: Step[], opts: { confirmations?: number; gone?: ConditionReading["gone"] } = {}) => {
    let state = new Map<string, HealthState>();
    const out: string[][] = [];
    for (const step of steps) {
      const reading = { items: new Map(Object.entries(step)), gone: opts.gone ?? null };
      const { next, events } = evaluateHealth(state, [{ integration: "nas", condition: "app", reading }], opts.confirmations ?? 2);
      state = next;
      out.push(events.map((e) => `${e.type} ${e.detail}`));
    }
    return { state, out };
  };
  const bad = (text: string): ItemReading => ({ bad: true, text });
  const ok = (text: string): ItemReading => ({ bad: false, text });

  it("warns after the confirmations and clears at once", () => {
    expect(run([{ a: bad("a stopped") }, { a: bad("a stopped") }, { a: bad("a stopped") }, { a: ok("a runs") }]).out).toEqual([
      [],
      ["warning a stopped"],
      [],
      ["cleared a runs"],
    ]);
    // One reading is a blip, and clears quietly.
    expect(run([{ a: bad("a stopped") }, { a: ok("a runs") }]).out).toEqual([[], []]);
    expect(run([{ a: bad("a stopped") }], { confirmations: 1 }).out).toEqual([["warning a stopped"]]);
  });

  it("holds an item between states", () => {
    expect(run([{ a: bad("x") }, { a: "hold" }, { a: bad("x") }]).out).toEqual([[], [], ["warning x"]]);
    expect(run([{ a: bad("x") }, { a: bad("x") }, { a: "hold" }, { a: ok("back") }]).out).toEqual([
      [],
      ["warning x"],
      [],
      ["cleared back"],
    ]);
  });

  it("clears an item that's gone only when its condition says so", () => {
    const steps: Step[] = [{ a: bad("Disk failing") }, { a: bad("Disk failing") }, {}];
    expect(run(steps, { gone: (t) => `resolved: ${t}` }).out[2]).toEqual(["cleared resolved: Disk failing"]);
    const quiet = run(steps);
    expect(quiet.out[2]).toEqual([]);
    expect(quiet.state.size).toBe(0);
  });

  it("keeps an entry only while a problem is open or being confirmed, its streak capped", () => {
    expect(run([{ a: bad("x") }, { a: bad("x") }, { a: bad("x") }, { a: bad("y") }]).state.get("nas|app|a")).toEqual({
      warned: true,
      streak: 2,
      text: "y",
    });
    expect(run([{ a: bad("x") }, { a: ok("x") }]).state.size).toBe(0);
  });

  it("leaves the other integrations and conditions alone", () => {
    const prev = new Map<string, HealthState>([
      ["nas|pool|tank", { warned: true, streak: 2, text: "pool tank is DEGRADED" }],
      ["nas2|app|a", { warned: true, streak: 2, text: "app a stopped" }],
    ]);
    const { next, events } = evaluateHealth(prev, [{ integration: "nas", condition: "app", reading: { items: new Map(), gone: () => "gone" } }], 2);
    expect(events).toEqual([]);
    expect([...next.keys()]).toEqual(["nas|pool|tank", "nas2|app|a"]);
  });
});

describe("checkIntegrationAlerts", () => {
  let dir: string;
  let alertOn: string[] | undefined;
  let enabled: boolean;

  const config = () =>
    configSchema.parse({
      settings: {
        siteUrl: "https://home.example",
        alerts: { enabled, confirmations: 2, channels: [{ id: "c", type: "webhook", url: "https://hook" }] },
      },
      integrations: [{ id: "nas", type: "truenas", name: "NAS", url: "https://nas.lan", alertOn }],
    });
  const entry = (at: number, data: Partial<TruenasSnapshot> | null, error: string | null = null): MonitorEntry => ({
    id: "nas",
    type: "truenas",
    label: "NAS",
    configured: true,
    enabled: true,
    urlSet: true,
    actionsAllowed: false,
    data: data && { pools: [], apps: [], alerts: [], ...data },
    error,
    at,
  });
  const failing = (at: number) => entry(at, { alerts: [{ id: "u1", level: "critical", message: "Disk sda is failing" }] });
  const sent = async () => {
    const { dispatchAlerts } = await import("./alerts");
    const all = vi.mocked(dispatchAlerts).mock.calls.flatMap((c) => c[1]);
    vi.mocked(dispatchAlerts).mockClear();
    return all;
  };
  const restart = async () => {
    await alertStateSaved();
    resetAlertState();
    resetCountedSnapshots();
  };

  beforeEach(async () => {
    resetAlertState();
    resetCountedSnapshots();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-integration-alerts-"));
    vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
    alertOn = ["alert"];
    enabled = true;
    await sent();
  });
  afterEach(async () => {
    await alertStateSaved();
    resetAlertState();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("counts new snapshots, not runs of the sampler, and links the integration's page", async () => {
    await checkIntegrationAlerts(config(), [failing(1)]);
    // The same cached snapshot, read again, confirms nothing.
    await checkIntegrationAlerts(config(), [failing(1)]);
    expect(await sent()).toEqual([]);
    await checkIntegrationAlerts(config(), [failing(2)]);
    expect(await sent()).toEqual([
      {
        event: { id: "nas|alert|u1", type: "warning", detail: "Disk sda is failing" },
        subject: { kind: "integration", id: "nas", name: "NAS", url: "https://home.example/admin/monitor/nas" },
      },
    ]);
    await checkIntegrationAlerts(config(), [entry(3, {})]);
    expect((await sent()).map((a) => [a.event.type, a.event.detail])).toEqual([["cleared", "resolved: Disk sda is failing"]]);
  });

  it("reads nothing from a snapshot that failed, or a list it couldn't read", async () => {
    await checkIntegrationAlerts(config(), [failing(1)]);
    await checkIntegrationAlerts(config(), [failing(2)]);
    await sent();
    // Stale data beside an error, then a snapshot without its alert list.
    await checkIntegrationAlerts(config(), [entry(3, {}, "Timed out")]);
    await checkIntegrationAlerts(config(), [entry(4, { unread: ["alerts"] })]);
    await checkIntegrationAlerts(config(), [entry(5, null, "Couldn't connect")]);
    expect(await sent()).toEqual([]);
    await checkIntegrationAlerts(config(), [entry(6, {})]);
    expect((await sent()).map((a) => a.event.type)).toEqual(["cleared"]);
  });

  it("doesn't announce a problem again after a restart, and still clears it", async () => {
    await checkIntegrationAlerts(config(), [failing(1)]);
    await checkIntegrationAlerts(config(), [failing(2)]);
    expect((await sent()).map((a) => a.event.type)).toEqual(["warning"]);
    await restart();
    await checkIntegrationAlerts(config(), [failing(3)]);
    expect(await sent()).toEqual([]);
    await checkIntegrationAlerts(config(), [entry(4, {})]);
    expect((await sent()).map((a) => a.event.type)).toEqual(["cleared"]);
    await alertStateSaved();
    expect(fs.existsSync(path.join(dir, "alert-state.json"))).toBe(false);
  });

  it("forgets a condition switched off, quietly", async () => {
    await checkIntegrationAlerts(config(), [failing(1)]);
    await checkIntegrationAlerts(config(), [failing(2)]);
    await sent();
    alertOn = ["pool"];
    await checkIntegrationAlerts(config(), [entry(3, {})]);
    expect(await sent()).toEqual([]);
    await alertStateSaved();
    expect(fs.existsSync(path.join(dir, "alert-state.json"))).toBe(false);
    alertOn = ["alert"];
    await checkIntegrationAlerts(config(), [failing(4)]);
    // Switched back on, it starts over: one reading isn't a warning yet.
    expect(await sent()).toEqual([]);
  });

  it("does nothing while alerts are off", async () => {
    enabled = false;
    await checkIntegrationAlerts(config(), [failing(1)]);
    enabled = true;
    await checkIntegrationAlerts(config(), [failing(2)]);
    // Only the second counted, so no warning yet.
    expect(await sent()).toEqual([]);
  });
});
