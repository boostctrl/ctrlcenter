import { describe, it, expect } from "vitest";
import { appNameFromUrl, needsSetup, parsePastedUrls } from "./setup";
import { configSchema } from "./schema";

// The first-run setup (#304).
describe("needsSetup", () => {
  it("is true only for a fresh install that hasn't finished or skipped it", () => {
    const fresh = configSchema.parse({});
    expect(needsSetup(fresh)).toBe(true);
    expect(needsSetup({ ...fresh, settings: { ...fresh.settings, setupComplete: true } })).toBe(false);
    const withApp = configSchema.parse({ apps: [{ id: "a", name: "A", url: "https://a.test" }] });
    expect(needsSetup(withApp)).toBe(false);
  });
});

describe("pasted apps", () => {
  it("finds the URLs, adds a missing scheme, skips the rest", () => {
    expect(parsePastedUrls("jellyfin.lan:8096\nhttps://nas.lan/ , ftp://x\nnot a url!\nhttps://nas.lan")).toEqual([
      "http://jellyfin.lan:8096",
      "https://nas.lan",
    ]);
  });

  it("names an app after its host", () => {
    expect(appNameFromUrl("http://jellyfin.lan:8096")).toBe("Jellyfin");
    expect(appNameFromUrl("https://photos.example.com")).toBe("Photos");
    expect(appNameFromUrl("http://192.168.1.10:8080")).toBe("192.168.1.10");
  });
});
