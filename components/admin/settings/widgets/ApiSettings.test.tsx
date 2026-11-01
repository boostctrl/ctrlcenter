import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newInstance, type InstanceOf } from "@/lib/schema";
import ApiSettings from "./ApiSettings";

type Api = InstanceOf<"api">;

// The editor over live state, as Settings → Widgets and the in-place panel
// run it; `stored()` is the instance every patch so far adds up to.
function setup(patch: Partial<Api> = {}) {
  const initial: Api = { ...newInstance("api", "api-1"), ...patch };
  const patches: Partial<Api>[] = [];
  function Harness() {
    const [w, setW] = useState(initial);
    return (
      <ApiSettings
        w={w}
        label="API 1"
        onChange={(p) => {
          patches.push(p);
          setW({ ...w, ...p });
        }}
        groups={[]}
        tags={[]}
        integrations={[]}
      />
    );
  }
  render(<Harness />);
  return {
    user: userEvent.setup(),
    patches,
    stored: () => patches.reduce<Api>((w, p) => ({ ...w, ...p }), initial),
  };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

// Number fields used to re-read and clamp the value on every keystroke, so a
// half-typed number was rewritten under the cursor (#397).
describe("API widget number fields keep what is typed (#397)", () => {
  it("keeps a decimal threshold: 0.8 stays 0.8, not 8", async () => {
    const { user, stored } = setup();
    await user.type(field("Warn at"), "0.8");
    expect(stored().thresholds.warn).toBe(0.8);
  });

  it("keeps a negative threshold: -5 stays -5", async () => {
    const { user, stored } = setup();
    await user.type(field("Critical at"), "-5");
    expect(stored().thresholds.critical).toBe(-5);
  });

  it("keeps a gauge's decimal Full at: 2.5 stays 2.5, not 25", async () => {
    const { user, stored } = setup({ display: "gauge" });
    const full = field("Full at");
    await user.clear(full);
    await user.type(full, "2.5");
    expect(stored().max).toBe(2.5);
  });

  it("clearing a threshold stores none", async () => {
    const { user, stored } = setup({ thresholds: { warn: 80, critical: null, direction: "above" } });
    await user.clear(field("Warn at"));
    expect(stored().thresholds.warn).toBeNull();
  });

  it("takes 30 as the refresh interval, saying what the range is while 3 is under it", async () => {
    const { user, stored, patches } = setup();
    const refresh = field("Refresh every (seconds)");
    await user.clear(refresh);
    await user.type(refresh, "3");
    // Not clamped to 15 under the cursor: the range is spelled out instead,
    // and the message is tied to the input.
    const error = screen.getByRole("alert");
    expect(error.textContent).toBe("Enter a whole number from 15 to 3600.");
    expect(refresh.getAttribute("aria-invalid")).toBe("true");
    expect(refresh.getAttribute("aria-describedby")).toBe(error.id);
    await user.type(refresh, "0");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(refresh.getAttribute("aria-invalid")).toBeNull();
    expect(stored().refresh).toBe(30);
    expect(patches.map((p) => p.refresh)).not.toContain(150);
    await user.tab();
    expect(refresh.value).toBe("30");
  });

  it("moves an out-of-range refresh to the nearest limit on Enter", async () => {
    const { user, stored } = setup();
    const refresh = field("Refresh every (seconds)");
    await user.clear(refresh);
    await user.type(refresh, "5{Enter}");
    expect(stored().refresh).toBe(15);
    expect(refresh.value).toBe("15");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts the stored value back when a required field is left blank", async () => {
    const { user, stored } = setup();
    const refresh = field("Refresh every (seconds)");
    await user.clear(refresh);
    await user.tab();
    expect(stored().refresh).toBe(60);
    expect(refresh.value).toBe("60");
  });
});
