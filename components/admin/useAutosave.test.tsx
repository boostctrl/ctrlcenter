import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutosave } from "./useAutosave";

// The admin forms' debounced autosave (#289): what it saves, when, and in
// what order.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(save: (v: string) => Promise<void>) {
  return renderHook(({ value }) => useAutosave(value, save, 600), {
    initialProps: { value: "initial" },
  });
}

describe("useAutosave", () => {
  it("never saves the initial value on mount", async () => {
    const save = vi.fn(async () => {});
    const { result } = setup(save);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("debounces a burst of edits into one save of the last value", async () => {
    const save = vi.fn(async () => {});
    const { result, rerender } = setup(save);
    rerender({ value: "a" });
    rerender({ value: "ab" });
    rerender({ value: "abc" });
    expect(result.current.status).toBe("saving");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    expect(result.current.status).toBe("saved");
  });

  it("keeps saves in order even when an earlier one is slower", async () => {
    const order: string[] = [];
    const save = vi.fn(async (v: string) => {
      await new Promise((r) => setTimeout(r, v === "first" ? 1000 : 10));
      order.push(v);
    });
    const { rerender } = setup(save);
    rerender({ value: "first" });
    await act(() => vi.advanceTimersByTimeAsync(600));
    rerender({ value: "second" });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(order).toEqual(["first", "second"]);
  });

  it("reports a failed save, and recovers on the next one", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("disk full");
    });
    const { result, rerender } = setup(save);
    rerender({ value: "x" });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(result.current).toEqual({ status: "error", error: "disk full" });
    fail = false;
    rerender({ value: "y" });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(result.current.status).toBe("saved");
  });

  it("flushes an edit still in its debounce window on unmount (#103)", async () => {
    const save = vi.fn(async () => {});
    const { rerender, unmount } = setup(save);
    rerender({ value: "unsaved" });
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(save).toHaveBeenCalledWith("unsaved", { keepalive: true });
  });
});
