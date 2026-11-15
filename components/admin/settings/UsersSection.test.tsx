import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import UsersSection from "./UsersSection";
import { ToastProvider } from "../Toast";
import { ConfirmProvider } from "../Confirm";

// Settings → Users (#423): the list from GET /api/accounts, and the add form
// posting a new account; the groups list (#505).
const listing = {
  current: "admin",
  groups: ["family", "ops"],
  groupUsage: [
    { id: "family", members: ["sam"], boards: 1, apps: 2, bookmarks: 0, only: 1 },
    { id: "ops", members: [], boards: 0, apps: 0, bookmarks: 0, only: 0 },
  ],
  accounts: [
    { id: "admin", name: "", role: "admin", enabled: true, groups: [], totp: true, mustChangePassword: false, requireTwoFactor: false, createdAt: "", lastSignInAt: "", sessions: 1 },
    { id: "sam", name: "Sam", role: "member", enabled: true, groups: ["family"], totp: false, mustChangePassword: true, requireTwoFactor: false, createdAt: "2026-11-01T00:00:00Z", lastSignInAt: "", sessions: 0 },
  ],
};
const calls: { url: string; init?: RequestInit }[] = [];
const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section")!;
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
    const accounts = within(card("Accounts"));
    expect(accounts.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
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
    const form = within(card("Add an account"));
    // Picked from the list (#505), in any order; sent sorted.
    fireEvent.click(form.getByRole("button", { name: "ops" }));
    fireEvent.click(form.getByRole("button", { name: "family" }));
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

  it("picks an account's groups from the list in its edit form", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    const picker = screen.getByRole("group", { name: "Groups for Sam" });
    expect(within(picker).getByRole("button", { name: "family" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(picker).getByRole("button", { name: "ops" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")?.init?.body))).toMatchObject({ groups: ["family", "ops"] });
  });
});

describe("UsersSection groups (#505)", () => {
  it("lists each group with its members and what is shared with it", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    const groups = within(card("Groups"));
    expect(groups.getByText("1 member: Sam")).toBeDefined();
    expect(groups.getByText("Shared with it: 1 board, 2 apps")).toBeDefined();
    expect(groups.getByText("No members")).toBeDefined();
    expect(groups.getByText("Nothing shared with it yet")).toBeDefined();
  });

  it("adds a group by name", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    fireEvent.change(screen.getByLabelText(/^New group/), { target: { value: " Guests" } });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/account-groups")).toBe(true));
    const post = calls.find((c) => c.url === "/api/account-groups");
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ id: "guests" });
  });

  it("asks before a rename merges into a group that exists, then merges", async () => {
    let renames = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "PATCH") {
          renames++;
          return renames === 1
            ? new Response(JSON.stringify({ error: "A group \"family\" already exists", exists: true }), { status: 409 })
            : new Response(JSON.stringify({ id: "family" }), { status: 200 });
        }
        return new Response(JSON.stringify(listing), { status: 200 });
      })
    );
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    const groups = within(card("Groups"));
    fireEvent.click(groups.getAllByRole("button", { name: "Rename" })[1]);
    const field = screen.getByLabelText(/^New name for ops/);
    fireEvent.change(field, { target: { value: "family" } });
    fireEvent.click(within(field.closest("form")!).getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Merge ops into family?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(renames).toBe(2));
    const sent = calls.filter((c) => c.init?.method === "PATCH");
    expect(sent.map((c) => c.url)).toEqual(["/api/account-groups/ops", "/api/account-groups/ops"]);
    expect(sent.map((c) => JSON.parse(String(c.init?.body)))).toEqual([
      { id: "family", merge: false },
      { id: "family", merge: true },
    ]);
  });

  it("says what removing a group changes before it goes", async () => {
    mount();
    await waitFor(() => expect(screen.queryByText("Sam")).not.toBeNull());
    fireEvent.click(within(card("Groups")).getAllByRole("button", { name: "Remove" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("1 account leaves it. 1 item shared with this group alone becomes visible to admins only.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.init?.method === "DELETE")?.url).toBe("/api/account-groups/family");
  });
});
