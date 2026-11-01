import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { LayoutWidget } from "@/lib/layout";
import { saveBoardLayout } from "./admin/settingsApi";
import { useLayoutEditor, type EditableLayout } from "./useLayoutEditor";
import { usePointerReorder } from "./usePointerReorder";

// One router object across renders, as Next's app router provides.
const router = vi.hoisted(() => ({ push: () => {}, refresh: () => {}, replace: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./admin/settingsApi", () => ({ saveBoardLayout: vi.fn(async () => {}) }));

// The layout editor's state hook (#290): the editing hotkeys around a drag,
// its autosave after a gesture, and the undo edge cases (#400).
const initial: EditableLayout = {
  sections: [
    { id: "notes-1", type: "notes", span: 24, hidden: false },
    { id: "apps-1", type: "apps", span: 12, hidden: false },
  ],
  scale: 100,
  gap: 32,
  topGap: 64,
};

function setup() {
  const setEditing = vi.fn();
  const gridRef = { current: null };
  const hook = renderHook(
    ({ editing }: { editing: boolean }) =>
      useLayoutEditor({ boardId: "home", isHome: true, initial, editing, setEditing, gridRef }),
    { initialProps: { editing: true } }
  );
  return { ...hook, setEditing };
}

// Escape as the page gets it: bubbling, so window's capture listeners run.
const escape = () =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

const spanOf = (layout: EditableLayout, id: string) => layout.sections.find((w) => w.id === id)?.span;

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(saveBoardLayout).mockClear();
  document.body.innerHTML = "";
});

describe("useLayoutEditor", () => {
  it("leaves edit mode on Escape with nothing selected", () => {
    const { setEditing } = setup();
    escape();
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  it("ignores Escape while a resize drag or a held stepper is in progress (#400)", () => {
    const { result, setEditing } = setup();
    act(() => result.current.gesture.begin());
    escape();
    expect(setEditing).not.toHaveBeenCalled();
    act(() => result.current.gesture.end());
    escape();
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  // The editor with the card-moving hook beside it, as Dashboard wires them,
  // and a card mid-drag: a mouse press moved past the slop.
  function setupMidDrag(setEditing: (editing: boolean) => void = vi.fn()) {
    const gridRef = { current: null };
    const trayRef = { current: null };
    const hook = renderHook(
      ({ setEditing }: { setEditing: (editing: boolean) => void }) => {
        const editor = useLayoutEditor({ boardId: "home", isHome: true, initial, editing: true, setEditing, gridRef });
        const pointer = usePointerReorder({
          enabled: true,
          gridRef,
          trayRef,
          onMove: () => {},
          onHide: () => {},
          onPlace: () => {},
          dragging: editor.dragging,
        });
        return { editor, pointer };
      },
      { initialProps: { setEditing } }
    );
    const card = document.createElement("div");
    document.body.append(card);
    const press = {
      button: 0,
      pointerType: "mouse",
      pointerId: 1,
      clientX: 100,
      clientY: 300,
      target: card,
      currentTarget: card,
    } as unknown as ReactPointerEvent<HTMLElement>;
    act(() => hook.result.current.pointer.begin(press, "notes-1", 0));
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 130, clientY: 300 }));
    });
    expect(hook.result.current.pointer.drag?.id).toBe("notes-1");
    return hook;
  }

  it("lets Escape cancel a card being moved without leaving edit mode (#400)", () => {
    const setEditing = vi.fn();
    const { result } = setupMidDrag(setEditing);
    escape();
    expect(result.current.pointer.drag).toBeNull();
    expect(setEditing).not.toHaveBeenCalled();
    // Once the drag is over, Escape leaves edit mode as before.
    escape();
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  it("cancels the move alone whichever Escape listener runs first (#400)", () => {
    // Both listen on window in the capture phase. The editor's is normally
    // the older, so it runs first; a re-registration mid-drag (a new
    // setEditing here) puts it after the drag's instead.
    const { result, rerender } = setupMidDrag();
    const setEditing = vi.fn();
    rerender({ setEditing });
    escape();
    expect(result.current.pointer.drag).toBeNull();
    expect(setEditing).not.toHaveBeenCalled();
  });

  it("keeps saving after a gesture that edit mode's end cut short (#400)", async () => {
    vi.useFakeTimers();
    const { result, rerender } = setup();
    // A resize drag begins, changes the card, and edit mode ends under it
    // (its handle unmounted before the pointerup that would have ended it).
    act(() => result.current.gesture.begin());
    act(() => result.current.setWidgetSpan("apps-1", 10));
    act(() => result.current.doneEditing());
    rerender({ editing: false });
    rerender({ editing: true });
    act(() => result.current.setWidgetSpan("apps-1", 6));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    const saved = vi.mocked(saveBoardLayout).mock.lastCall?.[1];
    expect(saved?.sections.find((w) => w.widget === "apps-1")?.span).toBe(6);
  });

  it("records no undo step for a change that changes nothing (#400)", () => {
    const { result } = setup();
    // End on a card already at 24 columns.
    act(() => result.current.setWidgetSpan("notes-1", 24));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.setWidgetSpan("notes-1", 12));
    act(() => result.current.undoLast());
    expect(spanOf(result.current.layout, "notes-1")).toBe(24);
    expect(result.current.canRedo).toBe(true);
    // Another clamped no-op leaves the redo stack alone too.
    act(() => result.current.setWidgetSpan("notes-1", 40));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redoLast());
    expect(spanOf(result.current.layout, "notes-1")).toBe(12);
  });

  it("keeps a widget added from the palette in the tray when its placement is undone (#400)", () => {
    const { result } = setup();
    const row: LayoutWidget = { id: "notes-2", type: "notes", span: 12, hidden: true };
    act(() => result.current.adoptWidget(row));
    // Adoption is not an undo step; the placement is.
    expect(result.current.canUndo).toBe(false);
    expect(result.current.layout.sections.at(-1)).toEqual(row);
    act(() =>
      result.current.mutateSections((sections) => [
        ...sections.filter((w) => w.id !== row.id),
        { ...row, hidden: false },
      ])
    );
    expect(result.current.layout.sections.at(-1)).toEqual({ ...row, hidden: false });
    act(() => result.current.undoLast());
    expect(result.current.layout.sections.find((w) => w.id === row.id)).toEqual(row);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redoLast());
    expect(result.current.layout.sections.find((w) => w.id === row.id)?.hidden).toBe(false);
    // Revert keeps it in the tray as well.
    act(() => result.current.revertLayout());
    expect(result.current.layout.sections.find((w) => w.id === row.id)).toEqual(row);
  });
});
