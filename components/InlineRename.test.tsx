import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RenameField } from "./InlineRename";

// The inline rename commits the trimmed value (#496), so its callers don't
// each have to, and Escape commits nothing.
describe("RenameField", () => {
  it("commits the trimmed value on Enter", () => {
    const onCommit = vi.fn();
    render(<RenameField initialValue="Media" onCommit={onCommit} onCancel={() => {}} label="Rename group" />);
    const input = screen.getByRole("textbox", { name: "Rename group" });
    fireEvent.change(input, { target: { value: "  Streaming  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Streaming");
  });

  it("commits nothing on Escape", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameField initialValue="Media" onCommit={onCommit} onCancel={onCancel} label="Rename group" />);
    const input = screen.getByRole("textbox", { name: "Rename group" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
