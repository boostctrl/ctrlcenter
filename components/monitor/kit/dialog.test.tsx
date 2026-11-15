import { describe, it, expect, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./dialog";

// The Monitor's dialogs (#518): the qBittorrent delete confirmation and the
// Portainer log viewer. They used to leave focus on the button behind them
// and ignore Escape.
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete</button>
      {open && (
        <Dialog title="Delete torrent" alert description="Remove it." onClose={close} initialFocus={cancelRef}>
          <button>Delete torrent and data</button>
          <button ref={cancelRef} onClick={close}>
            Cancel
          </button>
        </Dialog>
      )}
    </>
  );
}

describe("Dialog", () => {
  it("takes focus when it opens, closes on Escape and hands focus back", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete torrent" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBe(screen.getByText("Remove it.").id);
    // On Cancel, not the destructive button, so a stray Enter backs out.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" }));
  });

});
