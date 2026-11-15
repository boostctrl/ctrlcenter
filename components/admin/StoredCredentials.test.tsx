import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StoredCredentials from "./StoredCredentials";
import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./Confirm";

// Settings → Security → Stored credentials (#370).
type Status = { source: "env" | "file" | "none"; encrypted: number; plaintext: number; unreadable: number };
const calls: { url: string; init?: RequestInit }[] = [];
function serve(status: Status, after: Status = status) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(init?.method === "POST" ? after : status), { status: 200 });
    })
  );
}
afterEach(() => vi.unstubAllGlobals());

const mount = (onChange = () => {}) =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <StoredCredentials onChange={onChange} />
      </ConfirmProvider>
    </ToastProvider>
  );

describe("StoredCredentials", () => {
  it("offers to encrypt the plaintext ones now, and re-reads the checklist after", async () => {
    serve({ source: "file", encrypted: 2, plaintext: 3, unreadable: 0 }, { source: "file", encrypted: 5, plaintext: 0, unreadable: 0 });
    const onChange = vi.fn();
    mount(onChange);
    expect(await screen.findByText("2 credentials encrypted · 3 credentials still in plaintext, encrypted at the next save.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Encrypt now" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")?.init?.body))).toEqual({ action: "encrypt" });
    expect(await screen.findByText("5 credentials encrypted.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Encrypt now" })).toBeNull();
  });

  it("says why a value doesn't work, and holds the key replacement back", async () => {
    serve({ source: "file", encrypted: 1, plaintext: 0, unreadable: 1 });
    mount();
    expect(await screen.findByText(/1 credential that can't be opened with this key/)).toBeDefined();
    expect((screen.getByRole("button", { name: "Replace key" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains how to change a key from CONFIG_KEY instead of offering to", async () => {
    serve({ source: "env", encrypted: 4, plaintext: 0, unreadable: 0 });
    mount();
    expect(await screen.findByText("Encrypted with the key in CONFIG_KEY.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Replace key" })).toBeNull();
    expect(screen.getByText(/move the old one to CONFIG_KEY_PREVIOUS/)).toBeDefined();
  });

  it("asks before replacing the key", async () => {
    serve({ source: "file", encrypted: 1, plaintext: 0, unreadable: 0 });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Replace key" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Replace the encryption key?");
    fireEvent.click(screen.getAllByRole("button", { name: "Replace key" }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")?.init?.body))).toEqual({ action: "rotate" });
  });
});
