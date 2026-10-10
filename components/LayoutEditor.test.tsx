import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider } from "./admin/Confirm";
import { EditToolbar, WidgetFrame } from "./LayoutEditor";

// The edit-layout toolbar (#271): its controls and the guarded Reset.
function setup(overrides: Partial<Parameters<typeof EditToolbar>[0]> = {}) {
  const props = {
    status: "idle" as const,
    error: null,
    scale: 100,
    onScale: vi.fn(),
    gap: 32,
    onGap: vi.fn(),
    topGap: 64,
    onTopGap: vi.fn(),
    canUndo: false,
    onUndo: vi.fn(),
    canRedo: false,
    onRedo: vi.fn(),
    onRevert: vi.fn(),
    onReset: vi.fn(),
    resetsToEmpty: false,
    onDone: vi.fn(),
    ...overrides,
  };
  render(
    <ConfirmProvider>
      <EditToolbar {...props} />
    </ConfirmProvider>
  );
  return { props, toolbar: screen.getByRole("toolbar", { name: "Layout editor" }) };
}

describe("EditToolbar", () => {
  it("offers Done, and Undo only when there is something to undo", () => {
    const { props, toolbar } = setup();
    expect(within(toolbar).getByRole("button", { name: "Undo" })).toHaveProperty("disabled", true);
    expect(within(toolbar).getByRole("button", { name: "Redo" })).toHaveProperty("disabled", true);
    fireEvent.click(within(toolbar).getByRole("button", { name: "Done" }));
    expect(props.onDone).toHaveBeenCalledOnce();
  });

  it("offers Redo only when there is something to redo (#314)", () => {
    const onRedo = vi.fn();
    const { toolbar } = setup({ canRedo: true, onRedo });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Redo" }));
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("steps the UI scale up from the current value", () => {
    const onScale = vi.fn<(scale: number) => void>();
    setup({ scale: 100, onScale });
    const larger = screen.getByRole("button", { name: "Larger UI" });
    fireEvent.pointerDown(larger);
    fireEvent.pointerUp(larger);
    fireEvent.click(larger);
    expect(onScale).toHaveBeenCalled();
    expect(onScale.mock.calls.every(([v]) => v > 100)).toBe(true);
  });

  it("resets only after the confirm dialog is accepted", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(props.onReset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reset layout" })
    );
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it("words Reset as clearing on a board other than the home board", async () => {
    const user = userEvent.setup();
    const { props } = setup({ resetsToEmpty: true });
    await user.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Clear this board?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Clear board" }));
    expect(props.onReset).toHaveBeenCalledOnce();
  });
});

// A card in the editor (#313): selected by click or Enter, controls only when
// selected, arrow keys move it and Shift+arrows resize it.
function frame(overrides: Partial<Parameters<typeof WidgetFrame>[0]> = {}) {
  // jsdom has no matchMedia; report a large screen.
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const props = {
    widget: { id: "notes-1", type: "notes" as const, span: 8, hidden: false },
    label: "Notes",
    index: 1,
    count: 3,
    cellClass: "",
    node: <a href="https://example.com">a link</a>,
    fillTo: 8,
    titled: true,
    previewClass: "",
    selected: false,
    onSelect: vi.fn(),
    onAnnounce: vi.fn(),
    onMove: vi.fn(),
    onSpan: vi.fn(),
    onCards: vi.fn(),
    onHeight: vi.fn(),
    onSpace: vi.fn(),
    onToggleHidden: vi.fn(),
    onToggleLabel: vi.fn(),
    onConfigure: vi.fn(),
    onGrab: vi.fn(),
    clickEndsDrag: () => false,
    ...overrides,
  };
  render(<WidgetFrame {...props} />);
  return { props, card: screen.getByRole("group", { name: "Notes" }) };
}

describe("WidgetFrame", () => {
  it("shows the live card with no controls until selected", () => {
    const { props, card } = frame();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
    // The content can't take focus or clicks.
    expect(screen.getByText("a link").closest("[inert]")).toBeTruthy();
    fireEvent.click(card);
    expect(props.onSelect).toHaveBeenCalledWith("notes-1");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(props.onSelect).toHaveBeenCalledTimes(2);
    // Arrows do nothing until it's selected.
    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("gives a selected card its toolbar, and moves and resizes it from the keyboard", () => {
    const { props, card } = frame({ selected: true });
    const toolbar = screen.getByRole("toolbar", { name: "Notes controls" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Configure" }));
    expect(props.onConfigure).toHaveBeenCalledWith("notes-1");
    fireEvent.click(within(toolbar).getByRole("button", { name: "Hide" }));
    expect(props.onToggleHidden).toHaveBeenCalledWith("notes-1");
    expect(props.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(props.onMove).toHaveBeenCalledWith(1, 2);
    fireEvent.keyDown(card, { key: "ArrowUp" });
    expect(props.onMove).toHaveBeenCalledWith(1, 0);
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });
    expect(props.onSpan).toHaveBeenCalledWith("notes-1", 9);
    expect(props.onAnnounce).toHaveBeenCalledWith("Notes width 9 of 24 columns");
    fireEvent.keyDown(card, { key: "ArrowUp", shiftKey: true });
    expect(props.onHeight).toHaveBeenCalled();
  });

  it("doesn't move past either end", () => {
    const { props, card } = frame({ selected: true, index: 2 });
    fireEvent.keyDown(card, { key: "ArrowDown" });
    expect(props.onMove).not.toHaveBeenCalled();
  });
});
