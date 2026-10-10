import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { useScratchConfig } from "@/lib/testing/routes";
import { newInstance } from "@/lib/schema";

// What a board's data carries for an API widget (#302): a visitor gets the
// values, never the request behind them.
let loadHomeData: typeof import("./load").loadHomeData;

const widget = {
  ...newInstance("api", "nas"),
  title: "NAS",
  url: "http://nas.lan/pool",
  headers: [{ name: "Authorization", value: "Bearer secret" }],
  fields: [{ label: "Used", path: "$.used", unit: "%" }],
  visibility: "public" as const,
};

beforeAll(async () => {
  await useScratchConfig();
  const config = await import("@/lib/config");
  await config.replaceWidgets([widget]);
  ({ loadHomeData } = await import("./load"));
});

afterEach(() => vi.unstubAllGlobals());

async function load(isAdmin: boolean) {
  const { stripSecrets, readConfigInternal } = await import("@/lib/config");
  const config = stripSecrets(await readConfigInternal());
  const fetchMock = vi.fn(async () => Response.json({ used: 42 }));
  vi.stubGlobal("fetch", fetchMock);
  const data = await loadHomeData({
    settings: config.settings,
    instances: config.widgets,
    apps: [],
    bookmarks: [],
    groups: [],
    widgets: [{ id: "nas", type: "api", span: 8, hidden: false }],
    isAdmin,
    now: new Date(),
  });
  return { data, fetchMock };
}

describe("loadHomeData: API widgets", () => {
  it("gives a visitor the view but not the URL, headers or paths", async () => {
    const { data, fetchMock } = await load(false);
    expect(data.apiViews.nas.view).toMatchObject({ value: "42", unit: "%" });
    // The fetch used the stored header, not the page's blanked one.
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => String(u).includes("nas.lan"));
    expect(new Headers(call?.[1].headers).get("Authorization")).toBe("Bearer secret");
    const sent = JSON.stringify(data.instances);
    expect(sent).not.toContain("nas.lan");
    expect(sent).not.toContain("$.used");
    expect(data.instances.nas).toMatchObject({ title: "NAS", headers: [] });
  });

  it("gives the admin the whole widget", async () => {
    const { data } = await load(true);
    expect(data.instances.nas).toMatchObject({ url: "http://nas.lan/pool" });
  });
});
