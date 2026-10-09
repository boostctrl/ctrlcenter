import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePolling, type PollTask } from "./usePolling";
import { useNow } from "./useNow";

// The shared client polling loop (#286).

let hidden = false;
function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePolling", () => {
  it("runs on mount and then every interval", () => {
    const task = vi.fn<PollTask>();
    renderHook(() => usePolling(task, 1000));
    expect(task).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(3000));
    expect(task).toHaveBeenCalledTimes(4);
  });

  it("waits a full interval first when immediate is off", () => {
    const task = vi.fn<PollTask>();
    renderHook(() => usePolling(task, 1000, { immediate: false }));
    expect(task).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1000));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    const task = vi.fn<PollTask>();
    renderHook(() => usePolling(task, 1000, { enabled: false }));
    act(() => void vi.advanceTimersByTime(5000));
    expect(task).not.toHaveBeenCalled();
  });

  it("pauses while hidden and catches up when shown, if a run is due", () => {
    const task = vi.fn<PollTask>();
    renderHook(() => usePolling(task, 1000));
    act(() => setHidden(true));
    act(() => void vi.advanceTimersByTime(5000));
    expect(task).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));
    expect(task).toHaveBeenCalledTimes(2);
    act(() => void vi.advanceTimersByTime(1000));
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("doesn't refetch on a quick tab flick", () => {
    const task = vi.fn<PollTask>();
    renderHook(() => usePolling(task, 1000));
    act(() => void vi.advanceTimersByTime(200));
    act(() => setHidden(true));
    act(() => setHidden(false));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("aborts the previous run when the next starts, and on unmount", () => {
    const signals: AbortSignal[] = [];
    const task = vi.fn<PollTask>((signal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const { unmount } = renderHook(() => usePolling(task, 1000));
    act(() => void vi.advanceTimersByTime(1000));
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    unmount();
    expect(signals[1].aborted).toBe(true);
    act(() => void vi.advanceTimersByTime(5000));
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("re-runs at once with the new task when it changes", () => {
    const a = vi.fn<PollTask>();
    const b = vi.fn<PollTask>();
    const { rerender } = renderHook(({ task }) => usePolling(task, 1000), {
      initialProps: { task: a },
    });
    rerender({ task: b });
    expect(b).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(1000));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("refresh runs the task on demand and swallows its rejection", async () => {
    const task = vi.fn<PollTask>(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => usePolling(task, 1000));
    await act(() => result.current());
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe("useNow", () => {
  it("ticks while visible, pauses while hidden, and catches up when shown", () => {
    vi.setSystemTime(0);
    const { result } = renderHook(() => useNow(1000));
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1000);
    act(() => setHidden(true));
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe(1000);
    act(() => setHidden(false));
    expect(result.current).toBe(6000);
  });
});
