import { afterEach, describe, expect, it, vi } from "vitest";
import { apiTone, buildApiView, fetchApiJson, formatApiValue, getApiView } from "./api-widget";
import { newInstance, widgetInstancesUpdateSchema, type InstanceOf } from "./schema";
import { withoutEnvSecrets } from "./secrets";
import { swrCache } from "./swr-cache";

// The generic API widget (#302).
const api = (over: Partial<InstanceOf<"api">> = {}): InstanceOf<"api"> => ({
  ...newInstance("api", "nas"),
  url: "http://nas.lan/api",
  ...over,
});
const DATA = {
  pool: { used_pct: 91.256, name: "tank" },
  ok: true,
  disks: [
    { name: "sda", temp: 34 },
    { name: "sdb", temp: 41 },
  ],
  "disk usage": "7 TB",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mapping", () => {
  it("formats values for display", () => {
    expect(formatApiValue(91.256)).toBe("91.26");
    expect(formatApiValue(true)).toBe("yes");
    expect(formatApiValue(undefined)).toBe("—");
    expect(formatApiValue({ a: 1 })).toBe('{"a":1}');
    expect(formatApiValue("x".repeat(100))).toHaveLength(80);
  });

  it("tints past the thresholds, counting up or down", () => {
    const t = { warn: 80, critical: 90, direction: "above" as const };
    expect(apiTone(50, t)).toBe("ok");
    expect(apiTone("85", t)).toBe("warn");
    expect(apiTone(95, t)).toBe("critical");
    expect(apiTone(5, { warn: 20, critical: 10, direction: "below" })).toBe("critical");
    expect(apiTone("n/a", t)).toBe("ok");
  });

  it("builds each display from its paths", () => {
    const thresholds = { warn: 80, critical: 90, direction: "above" as const };
    expect(buildApiView(api({ fields: [{ label: "Used", path: "$.pool.used_pct", unit: "%" }], thresholds }), DATA)).toEqual({
      display: "stat",
      label: "Used",
      value: "91.26",
      unit: "%",
      tone: "critical",
    });
    const gauge = buildApiView(api({ display: "gauge", max: 200, fields: [{ label: "", path: "$.pool.used_pct", unit: "" }] }), DATA);
    expect(gauge).toMatchObject({ display: "gauge", ratio: 91.256 / 200 });
    expect(
      buildApiView(
        api({
          display: "kv",
          fields: [
            { label: "Pool", path: "$.pool.name", unit: "" },
            { label: "", path: '$["disk usage"]', unit: "" },
            { label: "Gone", path: "$.nope", unit: "" },
          ],
        }),
        DATA
      )
    ).toEqual({
      display: "kv",
      rows: [
        { label: "Pool", value: "tank" },
        { label: '$["disk usage"]', value: "7 TB" },
        { label: "Gone", value: "—" },
      ],
    });
    expect(buildApiView(api({ display: "list", list: { path: "$.disks", label: "$.name", value: "$.temp" } }), DATA)).toEqual({
      display: "list",
      rows: [
        { label: "sda", value: "34" },
        { label: "sdb", value: "41" },
      ],
    });
  });

  it("says what's wrong with a bad path or a list that isn't one", () => {
    expect(() => buildApiView(api({ fields: [{ label: "", path: "pool", unit: "" }] }), DATA)).toThrow(/Start the query with \$/);
    expect(() => buildApiView(api({ fields: [{ label: "", path: "$.ok == true", unit: "" }] }), DATA)).toThrow(/without a comparison/);
    expect(() => buildApiView(api({ display: "list", list: { path: "$.pool", label: "$", value: "" } }), DATA)).toThrow(/array/);
  });
});

describe("fetching", () => {
  it("expands ${ENV} in headers, sends a POST body as JSON, and refuses a non-http URL", async () => {
    vi.stubEnv("NAS_TOKEN", "t0k");
    const fetchMock = vi.fn(async () => Response.json(DATA));
    vi.stubGlobal("fetch", fetchMock);
    await fetchApiJson(api({ method: "POST", body: '{"q":1}', headers: [{ name: "Authorization", value: "Bearer ${NAS_TOKEN}" }] }));
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer t0k");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe('{"q":1}');
    await expect(fetchApiJson(api({ url: "file:///etc/passwd" }))).rejects.toThrow(/http/);
  });

  it("sends no environment value inside withoutEnvSecrets", async () => {
    vi.stubEnv("NAS_TOKEN", "t0k");
    const fetchMock = vi.fn(async () => Response.json(DATA));
    vi.stubGlobal("fetch", fetchMock);
    await withoutEnvSecrets(() => fetchApiJson(api({ headers: [{ name: "X-Key", value: "${NAS_TOKEN}" }] })));
    expect(new Headers(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).headers).get("X-Key")).toBe("");
  });

  it("caches per refresh window and keeps the last good data when a fetch fails", async () => {
    swrCache("api-widget:60", 0).deleteWhere(() => true);
    let status = 200;
    const fetchMock = vi.fn(async () => (status === 200 ? Response.json(DATA) : new Response("no", { status })));
    vi.stubGlobal("fetch", fetchMock);
    const w = api({ id: "cache-test", fields: [{ label: "", path: "$.pool.name", unit: "" }] });
    expect(await getApiView(w)).toEqual({ view: expect.objectContaining({ value: "tank" }), error: null });
    await getApiView(w);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Editing the fields reuses the cached response.
    expect((await getApiView({ ...w, fields: [{ label: "", path: "$.ok", unit: "" }] })).view).toMatchObject({ value: "yes" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Past the window a failing refresh runs behind the stale view, then the
    // last good data stays with the error beside it.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 61_000);
      status = 500;
      expect((await getApiView(w)).error).toBeNull();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await vi.waitFor(async () =>
        expect(await getApiView(w)).toEqual({ view: expect.objectContaining({ value: "tank" }), error: expect.any(String) })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("limits", () => {
  it("caps API widgets and checks their URL scheme", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...newInstance("api", `a${i}`) }));
    expect(widgetInstancesUpdateSchema.safeParse(many).success).toBe(false);
    expect(widgetInstancesUpdateSchema.safeParse([{ ...newInstance("api", "a"), url: "ftp://x" }]).success).toBe(false);
    expect(widgetInstancesUpdateSchema.safeParse([{ ...newInstance("api", "a"), url: "https://x" }]).success).toBe(true);
  });
});
