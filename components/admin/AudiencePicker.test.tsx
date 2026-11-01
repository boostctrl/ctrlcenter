import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AudiencePicker, { forgetAccounts } from "./AudiencePicker";

// The picker for who else sees a private item (#423): the member accounts
// and groups from /api/accounts, ticked into an audience, null when empty.
const listing = {
  accounts: [
    { id: "admin", name: "", role: "admin", enabled: true, groups: [] },
    { id: "sam", name: "Sam", role: "member", enabled: true, groups: ["family"] },
    { id: "kim", name: "", role: "member", enabled: false, groups: [] },
  ],
  groups: ["family"],
};

beforeEach(() => {
  forgetAccounts();
});

describe("AudiencePicker", () => {
  it("lists members and groups, never admins, and reports the ticked audience or null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(listing), { status: 200 })));
    const onChange = vi.fn();
    const { rerender } = render(<AudiencePicker idPrefix="t" value={undefined} onChange={onChange} />);
    await waitFor(() => expect(screen.queryByLabelText("Sam")).not.toBeNull());
    expect(screen.queryByLabelText(/admin/)).toBeNull();
    expect(screen.queryByLabelText(/kim/)).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Sam"));
    expect(onChange).toHaveBeenLastCalledWith({ users: ["sam"] });
    rerender(<AudiencePicker idPrefix="t" value={{ users: ["sam"] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/family/));
    expect(onChange).toHaveBeenLastCalledWith({ users: ["sam"], groups: ["family"] });
    rerender(<AudiencePicker idPrefix="t" value={{ users: ["sam"], groups: ["family"] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Sam"));
    expect(onChange).toHaveBeenLastCalledWith({ groups: ["family"] });
    rerender(<AudiencePicker idPrefix="t" value={{ groups: ["family"] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/family/));
    expect(onChange).toHaveBeenLastCalledWith(null);
    vi.unstubAllGlobals();
  });

  it("says so when there are no members or groups yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ accounts: listing.accounts.slice(0, 1), groups: [] }), { status: 200 })));
    render(<AudiencePicker idPrefix="t" value={undefined} onChange={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/No member accounts yet/)).not.toBeNull());
    vi.unstubAllGlobals();
  });
});
