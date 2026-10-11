import { describe, it, expect } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("contentSecurityPolicy", () => {
  it("allows same-origin and https images, so bundled backgrounds, uploads and linked wallpapers all load (#348)", () => {
    const csp = contentSecurityPolicy("abc", false);
    const imgSrc = csp.split("; ").find((d) => d.startsWith("img-src "));
    expect(imgSrc).toBe("img-src 'self' data: https:");
  });

  it("nonces scripts in production and keeps inline styles", () => {
    const prod = contentSecurityPolicy("abc", false);
    expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).toContain("style-src 'self' 'unsafe-inline'");
    expect(contentSecurityPolicy("abc", true)).toContain("'unsafe-eval'");
  });
});
