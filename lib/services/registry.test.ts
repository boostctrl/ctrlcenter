import { describe, it, expect } from "vitest";
import { serviceFingerprint } from "./registry";

// Which config edits invalidate a service's cached snapshot (#289).
const base = { enabled: true, url: "http://qb.lan", username: "a", password: "b", allowActions: false };

describe("serviceFingerprint", () => {
  it("ignores toggles that don't change the target", () => {
    expect(serviceFingerprint({ ...base, enabled: false, allowActions: true })).toBe(
      serviceFingerprint(base)
    );
  });

  it("changes when the URL or a credential changes", () => {
    expect(serviceFingerprint({ ...base, url: "http://other.lan" })).not.toBe(serviceFingerprint(base));
    expect(serviceFingerprint({ ...base, password: "c" })).not.toBe(serviceFingerprint(base));
  });

  it("doesn't depend on property order", () => {
    const reordered = { password: "b", username: "a", url: "http://qb.lan", enabled: true, allowActions: false };
    expect(serviceFingerprint(reordered)).toBe(serviceFingerprint(base));
  });
});
