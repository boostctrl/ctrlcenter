import { describe, it, expect } from "vitest";
import { guessCheckType, withHttpScheme } from "./urls";

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
