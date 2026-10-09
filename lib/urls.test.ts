import { describe, it, expect } from "vitest";
import { withHttpScheme } from "./urls";

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
