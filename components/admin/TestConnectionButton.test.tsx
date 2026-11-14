import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TestConnectionButton from "./TestConnectionButton";

const respond = (status: number, body: string) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status }))
  );

function Probe() {
  return (
    <TestConnectionButton<{ ok: boolean }>
      endpoint="/api/test"
      label="Test"
      pendingLabel="Testing…"
      renderResult={(d) => <span>{d.ok ? "✓ Works" : "✗ Broken"}</span>}
    />
  );
}

describe("TestConnectionButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the caller's result for a JSON reply", async () => {
    respond(200, JSON.stringify({ ok: true }));
    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("✓ Works")).toBeTruthy();
  });

  it("shows the server's error for a non-2xx", async () => {
    respond(401, JSON.stringify({ error: "Session expired" }));
    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("✗ Session expired")).toBeTruthy();
  });

  // #470: a 200 that isn't JSON (an auth proxy's sign-in page) settled on
  // nothing at all, neither ✓ nor ✗.
  it.each([
    ["an HTML page", "<!doctype html><title>Sign in</title>"],
    ["an empty body", ""],
    ["a bare JSON string", JSON.stringify("ok")],
  ])("fails visibly on a 200 with %s", async (_, body) => {
    respond(200, body);
    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("✗ Unexpected response")).toBeTruthy();
  });
});
