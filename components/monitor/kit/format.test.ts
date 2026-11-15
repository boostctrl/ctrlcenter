import { describe, it, expect } from "vitest";
import { formatCount } from "./format";

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

// The dashboard tile shortened counts with its own copy, which still read
// 999,950 queries as "1000.0k" after #490; it uses this one now.
describe("the AdGuard tile's query count", () => {
  it("reads in millions from 999,950", async () => {
    const { tileContent } = await import("../glances");
    const entry = {
      id: "adguard",
      type: "adguard",
      label: "AdGuard Home",
      configured: true,
      enabled: true,
      urlSet: true,
      actionsAllowed: false,
      error: null,
      at: 0,
      data: {
        protectionEnabled: true,
        totalQueries: 999_950,
        blocked: 0,
        blockedRatio: 0,
        avgProcessingMs: null,
        windowLabel: null,
        series: [],
        blockedSeries: [],
        topBlocked: [],
        topQueried: [],
        topClients: [],
        safeBrowsing: 0,
        parental: 0,
        filters: null,
      },
    } as Parameters<typeof tileContent>[0];
    expect(tileContent(entry, 0, "admin").lines[0]).toBe("1.0M queries");
  });
});
