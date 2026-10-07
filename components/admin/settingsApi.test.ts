import { describe, it, expect, vi, afterEach } from "vitest";
import { saveSettingsPatch } from "./settingsApi";

afterEach(() => vi.unstubAllGlobals());

describe("saveSettingsPatch", () => {
  it("PUTs just the patch to /api/settings", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await saveSettingsPatch({ bookmarkCategoryOrder: ["a", "b"] }, { keepalive: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(init?.method).toBe("PUT");
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(String(init?.body))).toEqual({ bookmarkCategoryOrder: ["a", "b"] });
  });

  it("throws the API's error message when it sends one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({ error: "Theme name taken" }, { status: 400 })
      )
    );
    await expect(saveSettingsPatch({ title: "x" }, { fallback: "nope" })).rejects.toThrow(
      "Theme name taken"
    );
  });

  it("falls back to the caller's message otherwise, network failures included", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("", { status: 500 })));
    await expect(saveSettingsPatch({ title: "x" }, { fallback: "Failed to save layout" })).rejects.toThrow(
      "Failed to save layout"
    );
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(saveSettingsPatch({ title: "x" }, { fallback: "Couldn't set the site theme." })).rejects.toThrow(
      "Couldn't set the site theme."
    );
  });
});
