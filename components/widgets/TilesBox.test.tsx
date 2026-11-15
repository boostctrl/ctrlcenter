import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import TilesBox from "./TilesBox";

// The tile grid's scroll box (#353) marks itself only while its rows
// overflow it — the fade is a mask, and a masked box costs the frosted
// designs their blur, so a grid that fits must stay unmarked.
let resize: (() => void)[] = [];
let observed: Element[] = [];

beforeEach(() => {
  resize = [];
  observed = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resize.push(cb);
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sized(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
}

describe("TilesBox", () => {
  it("marks the box while its rows overflow, and only then", () => {
    const { container } = render(
      <TilesBox>
        <div>tiles</div>
      </TilesBox>
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.classList.contains("widget-tiles")).toBe(true);
    // jsdom lays nothing out: 0 of 0 fits.
    expect(box.hasAttribute("data-overflow")).toBe(false);
    expect(resize).toHaveLength(1);

    sized(box, 480, 180);
    act(() => resize[0]());
    expect(box.hasAttribute("data-overflow")).toBe(true);

    sized(box, 180, 180);
    act(() => resize[0]());
    expect(box.hasAttribute("data-overflow")).toBe(false);
  });

  // #493: at an explicit height the box keeps its size while a search
  // narrows its rows, so watching only the box left the fade stale.
  it("re-measures when its rows change while the box keeps its size", async () => {
    const rows = (n: number) => (
      <TilesBox>
        <div className="grid">
          {Array.from({ length: n }, (_, i) => (
            <a key={i} href={`#${i}`}>
              tile {i}
            </a>
          ))}
        </div>
      </TilesBox>
    );
    const { container, rerender } = render(rows(2));
    const box = container.firstElementChild as HTMLElement;
    // The rows themselves are watched, so one resizing re-measures.
    expect(observed).toContain(box.firstElementChild);

    sized(box, 480, 180);
    rerender(rows(12));
    await act(async () => {});
    expect(box.hasAttribute("data-overflow")).toBe(true);

    sized(box, 120, 180);
    rerender(rows(3));
    await act(async () => {});
    expect(box.hasAttribute("data-overflow")).toBe(false);
  });
});
