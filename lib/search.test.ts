import { describe, it, expect } from "vitest";
import { buildSearchUrl, isValidCustomUrl } from "./search";
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
