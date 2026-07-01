import { describe, it, expect } from "vitest";
import { serializeForScript } from "./serialize";

describe("serializeForScript", () => {
  it("escapes `<`, `>`, and `&` so they can't appear literally in HTML", () => {
    const out = serializeForScript({ preset: "</script><script>alert(1)</script>" });
    // No literal `<`, `>` (or a literal `</script>`) survives in the output.
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out.toLowerCase()).not.toContain("</script");
    // They're present as unicode escapes instead.
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
  });

  it("escapes `&` too (defends against entity-based tricks)", () => {
    expect(serializeForScript({ x: "a&b" })).toContain("\\u0026");
    expect(serializeForScript({ x: "a&b" })).not.toContain("&");
  });

  it("escapes the U+2028 / U+2029 line separators", () => {
    const out = serializeForScript({ x: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(out).not.toContain(String.fromCharCode(0x2029));
  });

  it("stays valid JSON that round-trips to the original value", () => {
    const value = {
      preset: "</script>",
      nested: { s: "a<b>c&d", n: 42, arr: [1, "x", null] },
    };
    // The escaped output is still valid JSON (and therefore a valid JS object
    // literal, which is how the inline theme script consumes it) and decodes
    // back to exactly the original value.
    expect(JSON.parse(serializeForScript(value))).toEqual(value);
  });

  it("leaves ordinary values untouched", () => {
    expect(serializeForScript({ mode: "dark", accentFrom: "#a78bfa" })).toBe(
      '{"mode":"dark","accentFrom":"#a78bfa"}'
    );
  });
});
