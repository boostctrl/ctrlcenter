import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { MotionLevel } from "@/lib/theme";
import Traces from "./Traces";

// A 2D context that keeps every fill with the glow (shadowBlur) it was drawn
// with: the pads are plain fills, the signal pulses glowing ones.
function recordFills() {
  const fills: { blur: number }[] = [];
  const state: Record<string | symbol, unknown> = { shadowBlur: 0 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "fill") return () => fills.push({ blur: Number(target.shadowBlur) });
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );
  return fills;
}

const draw = (motion: MotionLevel) =>
  render(<Traces light={false} motion={motion} accentFrom="#7c3aed" accentTo="#06b6d4" />);

describe("Traces scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // #492: the still frame skipped moving the pulses but still drew them.
  it("draws traces and pads but no signal pulses in its still frame", () => {
    const fills = recordFills();
    draw("off");
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.filter((f) => f.blur > 0)).toEqual([]);
  });

  it("draws the signal pulses when it moves", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const fills = recordFills();
    const { unmount } = draw("normal");
    expect(fills.filter((f) => f.blur > 0).length).toBeGreaterThanOrEqual(4);
    unmount();
  });
});
