import { describe, it, expect } from "vitest";
import {
  buildSearchUrl,
  isValidCustomUrl,
  parseBang,
  resolveBang,
  appBangMap,
} from "./search";
import { searchUpdateSchema } from "./schema";

describe("buildSearchUrl", () => {
  it("builds a preset URL with an encoded query", () => {
    expect(
      buildSearchUrl({ engine: "duckduckgo", customUrl: "" }, "hello world")
    ).toBe("https://duckduckgo.com/?q=hello%20world");
  });

  it("returns null for an empty query", () => {
    expect(buildSearchUrl({ engine: "google", customUrl: "" }, "   ")).toBeNull();
  });

  it("uses a valid custom template", () => {
    expect(
      buildSearchUrl(
        { engine: "custom", customUrl: "https://s.example.com/?q=%s" },
        "a b"
      )
    ).toBe("https://s.example.com/?q=a%20b");
  });

  it("returns null for an invalid custom template", () => {
    expect(
      buildSearchUrl({ engine: "custom", customUrl: "https://s.example.com/" }, "x")
    ).toBeNull();
    expect(
      buildSearchUrl({ engine: "custom", customUrl: "javascript:alert(1)?%s" }, "x")
    ).toBeNull();
  });
});

describe("isValidCustomUrl", () => {
  it("requires http(s) and a %s placeholder", () => {
    expect(isValidCustomUrl("https://x.com/?q=%s")).toBe(true);
    expect(isValidCustomUrl("http://x.com/%s")).toBe(true);
    expect(isValidCustomUrl("https://x.com/?q=foo")).toBe(false);
    expect(isValidCustomUrl("ftp://x.com/%s")).toBe(false);
  });
});

describe("parseBang", () => {
  it("splits a leading bang and its term", () => {
    expect(parseBang("!yt cats")).toEqual({ key: "yt", term: "cats" });
    expect(parseBang("  !GH  next js ")).toEqual({ key: "gh", term: "next js" });
    expect(parseBang("!yt")).toEqual({ key: "yt", term: "" });
  });

  it("returns null without a leading bang", () => {
    expect(parseBang("just a search")).toBeNull();
    expect(parseBang("a !yt later")).toBeNull();
    expect(parseBang("!")).toBeNull();
  });
});

describe("resolveBang", () => {
  const apps = [{ name: "Jellyfin", url: "https://jelly.example.com" }];
  const appBangs = appBangMap(apps);

  it("resolves a built-in bang with an encoded term", () => {
    expect(resolveBang("!yt cats and dogs")?.url).toBe(
      "https://www.youtube.com/results?search_query=cats%20and%20dogs"
    );
  });

  it("opens the engine root for a bare built-in bang", () => {
    expect(resolveBang("!yt")?.url).toBe("https://www.youtube.com");
  });

  it("lets a custom bang override a built-in", () => {
    const hit = resolveBang("!gh thing", [
      { key: "gh", url: "https://my.git/search?q=%s" },
    ]);
    expect(hit?.url).toBe("https://my.git/search?q=thing");
  });

  it("falls through to an app-name bang", () => {
    const hit = resolveBang("!jellyfin", [], appBangs);
    expect(hit).toEqual({ url: "https://jelly.example.com", label: "Jellyfin" });
  });

  it("returns null for an unknown bang and for no bang", () => {
    expect(resolveBang("!nope term", [], appBangs)).toBeNull();
    expect(resolveBang("plain search", [], appBangs)).toBeNull();
  });

  it("exposes the term only when one was given (for the hint)", () => {
    expect(resolveBang("!yt cats")?.term).toBe("cats");
    expect(resolveBang("!yt")?.term).toBeUndefined();
  });
});

describe("appBangMap", () => {
  it("slugs names and keeps the first on a collision", () => {
    const m = appBangMap([
      { name: "Media Server", url: "https://a" },
      { name: "mediaserver", url: "https://b" },
    ]);
    expect(m.mediaserver).toEqual({ url: "https://a", name: "Media Server" });
  });

  it("also slugs subtitles as aliases, labelled with the app name", () => {
    const m = appBangMap([
      { name: "Jellyfin", subtitle: "Media", url: "https://jelly" },
    ]);
    expect(m.jellyfin).toEqual({ url: "https://jelly", name: "Jellyfin" });
    expect(m.media).toEqual({ url: "https://jelly", name: "Jellyfin" });
  });

  it("lets any app name win a slug collision with another app's subtitle", () => {
    const m = appBangMap([
      { name: "Downloads", subtitle: "Media", url: "https://dl" },
      { name: "Media", subtitle: "Movies", url: "https://plex" },
    ]);
    // "Media" is a subtitle of Downloads but the real name of the second app;
    // names are registered before any subtitle, so the name wins.
    expect(m.media).toEqual({ url: "https://plex", name: "Media" });
  });
});

describe("searchUpdateSchema", () => {
  it("accepts a preset engine regardless of customUrl", () => {
    expect(
      searchUpdateSchema.safeParse({ engine: "bing", customUrl: "" }).success
    ).toBe(true);
  });

  it("rejects a custom engine without a valid template", () => {
    expect(
      searchUpdateSchema.safeParse({ engine: "custom", customUrl: "nope" }).success
    ).toBe(false);
    expect(
      searchUpdateSchema.safeParse({
        engine: "custom",
        customUrl: "https://x.com/?q=%s",
      }).success
    ).toBe(true);
  });
});
