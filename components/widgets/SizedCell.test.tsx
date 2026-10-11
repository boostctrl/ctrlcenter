import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import SizedCell from "./SizedCell";

// A sized cell's scrolling box becomes a named Tab stop only while it
// overflows and holds nothing focusable (#355).
let resize: (() => void)[] = [];

beforeEach(() => {
  resize = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resize.push(cb);
      }
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sized(el: Element, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
}

describe("SizedCell", () => {
  it("makes an overflowing card a region named after its heading, and only then", () => {
    const { container } = render(
      <SizedCell className="widget-sized" style={{ height: 200 }}>
        <section>
          <div>
            <h2>House rules</h2>
          </div>
          <div className="glass-card">Renew the certificates.</div>
        </section>
      </SizedCell>
    );
    const card = container.querySelector(".glass-card")!;
    expect(card.getAttribute("tabindex")).toBeNull();
    sized(card, 480, 200);
    act(() => resize[0]());
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("role")).toBe("region");
    expect(card.getAttribute("aria-label")).toBe("House rules");
    sized(card, 200, 200);
    act(() => resize[0]());
    expect(card.hasAttribute("tabindex")).toBe(false);
    expect(card.hasAttribute("role")).toBe(false);
    expect(card.hasAttribute("aria-label")).toBe(false);
  });

  it("adds no stop to a tile box that already holds focusable tiles", () => {
    const { container } = render(
      <SizedCell className="widget-sized" style={{ height: 220 }}>
        <section>
          <div className="widget-tiles">
            <a href="https://plex.example.com">Plex</a>
          </div>
        </section>
      </SizedCell>
    );
    const box = container.querySelector(".widget-tiles")!;
    sized(box, 480, 220);
    act(() => resize[0]());
    expect(box.hasAttribute("tabindex")).toBe(false);
  });
});
