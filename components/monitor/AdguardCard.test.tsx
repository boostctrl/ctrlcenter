import { describe, it, expect } from "vitest";
import { formatCount } from "./AdguardCard";

describe("formatCount", () => {
  it("keeps small counts whole and shortens big ones", () => {
    expect(formatCount(9_999)).toBe("9999");
    expect(formatCount(45_210)).toBe("45.2k");
    expect(formatCount(2_340_000)).toBe("2.3M");
  });

  // #490: 999,950 and up rounded to "1000.0k" before millions took over.
  it("switches to millions where thousands would show as 1000.0k", () => {
    expect(formatCount(999_949)).toBe("999.9k");
    expect(formatCount(999_950)).toBe("1.0M");
    expect(formatCount(999_999)).toBe("1.0M");
    expect(formatCount(1_000_000)).toBe("1.0M");
  });
});
