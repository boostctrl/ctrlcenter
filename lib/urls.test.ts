import { describe, it, expect } from "vitest";
import { guessCheckType, isPlainHttp, safeNextPath, siteLink, withHttpScheme } from "./urls";

describe("isPlainHttp (#560)", () => {
  it("tells a plain http address from anything else", () => {
    expect(isPlainHttp("http://truenas.lan")).toBe(true);
    expect(isPlainHttp("  HTTP://192.168.1.10/ ")).toBe(true);
    for (const no of ["https://truenas.lan", "", "truenas.lan", "${TRUENAS_URL}", "httpx://a"]) {
      expect(isPlainHttp(no)).toBe(false);
    }
  });
});

describe("withHttpScheme (#277)", () => {
  it("prefixes bare hosts with http://", () => {
    expect(withHttpScheme("plex.local:32400")).toBe("http://plex.local:32400");
    expect(withHttpScheme("192.168.1.5:8096/web")).toBe("http://192.168.1.5:8096/web");
    expect(withHttpScheme("  nas  ")).toBe("http://nas");
    expect(withHttpScheme("//host.lan")).toBe("http://host.lan");
  });

  it("leaves URLs that already have a scheme alone", () => {
    expect(withHttpScheme("https://cloud.example.com")).toBe("https://cloud.example.com");
    expect(withHttpScheme("HTTP://Upper.lan")).toBe("HTTP://Upper.lan");
    expect(withHttpScheme("ftp://files.lan")).toBe("ftp://files.lan");
  });

  it("keeps an empty field empty", () => {
    expect(withHttpScheme("   ")).toBe("");
  });
});

describe("guessCheckType (#296)", () => {
  it("watches web addresses over HTTP", () => {
    expect(guessCheckType("https://nas.local:22")).toBe("http");
    expect(guessCheckType("plex.local:32400")).toBe("http");
    expect(guessCheckType("nas.local")).toBe("http");
    expect(guessCheckType("")).toBe("http");
  });

  it("uses TCP for a bare host on a non-web port, DNS on 53", () => {
    expect(guessCheckType("nas.local:22")).toBe("tcp");
    expect(guessCheckType("10.0.0.5:5432/")).toBe("tcp");
    expect(guessCheckType("[fd00::1]:3306")).toBe("tcp");
    expect(guessCheckType("10.0.0.1:53")).toBe("dns");
  });
});

describe("safeNextPath (#23)", () => {
  const ORIGIN = "https://dash.example";
  const next = (value: string | null) => safeNextPath(value, ORIGIN);
  // What useSearchParams hands the login form: the query, percent-decoded.
  const fromQuery = (query: string) => next(new URLSearchParams(query).get("next"));

  it("follows a path on this origin, query and hash kept", () => {
    expect(next("/admin/monitor?x=1#y")).toBe("/admin/monitor?x=1#y");
    expect(next("/b/media")).toBe("/b/media");
  });

  it("refuses another origin, however it's spelled", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "///evil.example",
      "/.//evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "//[",
    ]) {
      expect(next(value), JSON.stringify(value)).toBe("/admin");
    }
  });

  it("refuses the encoded forms once the query is decoded", () => {
    expect(fromQuery("next=/%09/evil.example")).toBe("/admin");
    expect(fromQuery("next=/%0a/evil.example")).toBe("/admin");
    expect(fromQuery("next=/%0d/evil.example")).toBe("/admin");
    expect(fromQuery("next=/%2F%2Fevil.example")).toBe("/admin");
    expect(fromQuery("next=/%5Cevil.example")).toBe("/admin");
  });

  it("falls back to /admin with nothing to follow", () => {
    expect(next(null)).toBe("/admin");
    expect(next("")).toBe("/admin");
    expect(fromQuery("")).toBe("/admin");
  });
});

describe("siteLink (#539)", () => {
  it("puts a page under the site address, or gives nothing without one", () => {
    expect(siteLink("https://home.example", "/b/infra")).toBe("https://home.example/b/infra");
    expect(siteLink(" https://home.example/ ", "/")).toBe("https://home.example/");
    expect(siteLink("https://x.example/home/", "/b/infra")).toBe("https://x.example/home/b/infra");
    expect(siteLink("https://home.example", "b/infra")).toBe("https://home.example/b/infra");
    for (const none of ["", "  ", "home.example", "javascript:alert(1)", "https://"]) {
      expect(siteLink(none, "/")).toBe("");
    }
  });
});
