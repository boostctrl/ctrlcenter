import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useDragResize } from "./useDragResize";
import { UndoGestureContext } from "./useUndoHistory";

// Drag-to-resize (#312): how a drag ends, and that it always does (#400).
function Resizer() {
  const { frameRef, previewRef, drag, widthHandle } = useDragResize({
    span: 8,
    height: undefined,
    onSpan: () => {},
    onHeight: () => {},
  });
  return (
    <div>
      <div ref={frameRef}>
        <div ref={previewRef} />
        <span data-testid="handle" {...widthHandle} />
        {drag && <span data-testid="dragging" />}
      </div>
    </div>
  );
}

function setup() {
  const gesture = { begin: vi.fn(), end: vi.fn(), group: vi.fn() };
  const view = render(
    <UndoGestureContext.Provider value={gesture}>
      <Resizer />
    </UndoGestureContext.Provider>
  );
  const handle = screen.getByTestId("handle");
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  expect(gesture.begin).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("dragging")).not.toBeNull();
  return { ...view, gesture, handle };
}

describe("useDragResize", () => {
  it("ends the drag, and its undo gesture, on release", () => {
    const { gesture, handle } = setup();
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(gesture.end).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("dragging")).toBeNull();
  });

  it("ends the drag when the handle loses the pointer capture (#400)", () => {
    const { gesture, handle } = setup();
    fireEvent(handle, new Event("lostpointercapture"));
    expect(gesture.end).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("dragging")).toBeNull();
    // The release that may still follow doesn't end it twice.
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(gesture.end).toHaveBeenCalledOnce();
  });

  it("ends the drag when the handle unmounts mid-drag (#400)", () => {
    const { gesture, unmount } = setup();
    unmount();
    expect(gesture.end).toHaveBeenCalledOnce();
  });
});
