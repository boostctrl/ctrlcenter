import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newInstance } from "@/lib/schema";
import { ConfirmProvider } from "./admin/Confirm";
import WidgetPanel from "./WidgetPanel";

// Removing a widget for good from its settings panel (#318).
const notes = { ...newInstance("notes", "notes-2"), content: "hi" };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ widget: notes, groups: [], tags: [], integrations: [], boards: ["Home", "Media"] });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onRemoved = vi.fn();
  render(
    <ConfirmProvider>
      <WidgetPanel id="notes-2" label="Notes 2" onClose={vi.fn()} onSaved={vi.fn()} onRemoved={onRemoved} />
    </ConfirmProvider>
  );
  return { onRemoved };
}

describe("WidgetPanel Remove", () => {
  it("names the boards it comes off, says Undo can't bring it back, then deletes it", async () => {
    const user = userEvent.setup();
    const { onRemoved } = setup();
    await user.click(await screen.findByRole("button", { name: "Remove widget" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Home, Media");
    expect(dialog.textContent).toMatch(/Undo can't bring it back/);
    await user.click(within(dialog).getByRole("button", { name: "Remove widget" }));
    await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/widgets/notes-2", { method: "DELETE" });
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const { onRemoved } = setup();
    await user.click(await screen.findByRole("button", { name: "Remove widget" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(onRemoved).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});
