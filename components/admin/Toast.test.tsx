import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

// Toasts, and the inline action Undo rides on (#307).
afterEach(() => {
  vi.useRealTimers();
});

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast("Deleted “Plex”", "success", onUndo && { label: "Undo", onClick: onUndo })
      }
    >
      go
    </button>
  );
}

describe("ToastProvider", () => {
  it("shows a message and clears it after a few seconds", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("Deleted “Plex”")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("Deleted “Plex”")).toBeNull();
  });

  it("keeps an action toast up longer, runs the action once, and dismisses", () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText("go"));
    act(() => vi.advanceTimersByTime(4000));
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
