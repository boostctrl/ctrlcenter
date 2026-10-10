import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider } from "./admin/Confirm";
import { EditToolbar } from "./LayoutEditor";

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
    fireEvent.click(within(toolbar).getByRole("button", { name: "Done" }));
    expect(props.onDone).toHaveBeenCalledOnce();
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
