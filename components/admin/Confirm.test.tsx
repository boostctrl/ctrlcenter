import { describe, it, expect } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "./Confirm";

// Renders a button that opens the dialog and records how it settled.
function Harness({ danger, onResult }: { danger: boolean; onResult: (ok: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () =>
        onResult(
          await confirm({
            title: "Delete “Plex”?",
            message: "It's removed everywhere.",
            confirmLabel: "Delete",
            danger,
          })
        )
      }
    >
      open
    </button>
  );
}

async function open(danger: boolean) {
  const results: boolean[] = [];
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <Harness danger={danger} onResult={(ok) => results.push(ok)} />
    </ConfirmProvider>
  );
  await user.click(screen.getByRole("button", { name: "open" }));
  const dialog = await screen.findByRole("alertdialog");
  // Focus is seeded a task after opening (#146); let it land.
  await act(() => new Promise((r) => setTimeout(r, 10)));
  return { user, dialog, results };
}

describe("Confirm dialog (#269)", () => {
  it("is labelled and described by its title and message", async () => {
    const { dialog } = await open(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const label = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    const desc = document.getElementById(dialog.getAttribute("aria-describedby")!);
    expect(label?.textContent).toBe("Delete “Plex”?");
    expect(desc?.textContent).toBe("It's removed everywhere.");
  });

  it("starts a destructive dialog on Cancel, so Enter backs out", async () => {
    const { user, results } = await open(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(results).toEqual([false]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("starts a non-destructive dialog on its action, and Enter accepts", async () => {
    const { user, results } = await open(false);
    expect(document.activeElement?.textContent).toBe("Delete");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("Escape cancels", async () => {
    const { user, results } = await open(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(results).toEqual([false]));
  });
});
