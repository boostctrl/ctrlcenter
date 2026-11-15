import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import UsersSection from "./UsersSection";
import { ToastProvider } from "../Toast";
import { ConfirmProvider } from "../Confirm";

// Settings → Users (#423): the list from GET /api/accounts, and the add form
// posting a new account.
const listing = {
  current: "admin",
  groups: ["family"],
  accounts: [
    { id: "admin", name: "", role: "admin", enabled: true, groups: [], totp: true, mustChangePassword: false, requireTwoFactor: false, createdAt: "", lastSignInAt: "", sessions: 1 },
    { id: "sam", name: "Sam", role: "member", enabled: true, groups: ["family"], totp: false, mustChangePassword: true, requireTwoFactor: false, createdAt: "2026-11-01T00:00:00Z", lastSignInAt: "", sessions: 0 },
  ],
};
const calls: { url: string; init?: RequestInit }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "kim" }), { status: 201 });
      return new Response(JSON.stringify(listing), { status: 200 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <UsersSection />
      </ConfirmProvider>
    </ToastProvider>
  );

describe("UsersSection", () => {
  it("lists the accounts with their role, flags and groups, and keeps the admin's own row out of harm's way", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    expect(screen.getByText("(you)")).toBeDefined();
    expect(screen.getByText("2FA on")).toBeDefined();
    expect(screen.getByText("Must set a password at sign-in")).toBeDefined();
    expect(screen.getByText(/Groups: family/)).toBeDefined();
    // The admin's own row offers no Disable, Reset password or Remove.
    const removes = screen.getAllByRole("button", { name: "Remove" });
    expect(removes).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reset password" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeNull();
  });

  // #449: an admin can require a second factor of an account.
  it("requires two-factor of an account from its edit form", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.click(within(form).getByRole("switch", { name: "Require two-factor authentication" }));
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch?.url).toBe("/api/accounts/sam");
    expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ requireTwoFactor: true });
  });

  it("says when an account must still set up the second factor it's required to have", async () => {
    const required = {
      ...listing,
      accounts: [
        { ...listing.accounts[0], requireTwoFactor: true },
        { ...listing.accounts[1], requireTwoFactor: true },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(required), { status: 200 })));
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    expect(screen.getByText("2FA on, required")).toBeDefined();
    expect(screen.getByText("Must set up 2FA at sign-in")).toBeDefined();
  });

  it("adds an account with a first password and the must-change flag", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    fireEvent.change(screen.getByLabelText(/^Sign-in name/), { target: { value: "Kim" } });
    fireEvent.change(screen.getByLabelText(/^Groups/), { target: { value: "family, ops" } });
    fireEvent.change(screen.getByLabelText(/^First password/), { target: { value: "a-first-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toBe("/api/accounts");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      id: "kim",
      name: "",
      role: "member",
      groups: ["family", "ops"],
      password: "a-first-password-1",
      mustChangePassword: true,
      requireTwoFactor: false,
    });
  });
});
