import { describe, it, expect } from "vitest";
import { describeEvent } from "./SecurityActivity";

describe("describeEvent", () => {
  it("counts a folded run and its addresses", () => {
    expect(describeEvent({ at: 0, kind: "signin.fail", ip: "203.0.113.1", userAgent: "", count: 4 })).toBe(
      "Failed sign-in × 4"
    );
    expect(
      describeEvent({ at: 0, kind: "signin.fail", ip: "203.0.113.1", userAgent: "", count: 30, addresses: 12 })
    ).toBe("Failed sign-in × 30 from 12 addresses");
  });

  it("says when a flood entry covers several accounts (#456)", () => {
    expect(
      describeEvent({
        at: 0,
        kind: "signin.fail",
        ip: "203.0.113.1",
        userAgent: "",
        account: "alice",
        count: 30,
        addresses: 12,
        manyAccounts: true,
      })
    ).toBe("Failed sign-in × 30 from 12 addresses for several accounts");
  });
});
