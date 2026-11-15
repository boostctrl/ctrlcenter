"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Hint, ListPanel, TextField, ToggleRow, controlClasses, fieldLabelClasses, subCardClasses } from "../ui";
import { useToast } from "../Toast";
import { useConfirm } from "../Confirm";
import { apiErrorMessage } from "../apiError";
import { fetchWithReauth } from "../reauth";
import { forgetAccounts } from "../AudiencePicker";
import { relativeTime } from "@/components/StatusTimeline";
import { ChipToggles } from "@/components/ChipGroup";

// Settings → Users (#423): every account, with what it is and what it holds,
// and the admin's work on it — add, rename, change role and groups, enable
// or disable, reset the password, sign out everywhere, drop a lost second
// factor, require one (#449), remove — and the groups list (#505): add,
// rename or merge, remove, each changing every account and audience that
// names the group. The steps that open a way in, or change who sees what,
// confirm the admin's password first (fetchWithReauth).
type Account = {
  id: string;
  name: string;
  role: "admin" | "member";
  enabled: boolean;
  groups: string[];
  totp: boolean;
  mustChangePassword: boolean;
  requireTwoFactor: boolean;
  createdAt: string;
  lastSignInAt: string;
  sessions: number;
};
type GroupUsage = { id: string; members: string[]; boards: number; apps: number; bookmarks: number; only: number };
type Listing = { accounts: Account[]; groups: string[]; groupUsage: GroupUsage[]; current: string };

const groupsText = (groups: string[]) => groups.join(", ");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// "1 board, 2 apps", or null when nothing is shared with the group.
function sharedText(g: GroupUsage): string | null {
  const parts = [
    g.boards ? plural(g.boards, "board") : "",
    g.apps ? plural(g.apps, "app") : "",
    g.bookmarks ? plural(g.bookmarks, "bookmark") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

const emptyAdd = {
  id: "",
  name: "",
  role: "member" as "admin" | "member",
  groups: [] as string[],
  password: "",
  mustChangePassword: true,
  requireTwoFactor: false,
};

export default function UsersSection() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [add, setAdd] = useState(emptyAdd);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", role: "member" as "admin" | "member", groups: [] as string[], requireTwoFactor: false });
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (!res.ok) {
      toast("Couldn't load the accounts", "error");
      return;
    }
    setListing((await res.json()) as Listing);
    setNow(Date.now());
    forgetAccounts();
  }, [toast]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the list after mount
    void load();
  }, [load]);

  // One request, then the list again; the message names what went wrong.
  async function act(label: string, go: () => Promise<Response>, done?: string) {
    setBusy(true);
    try {
      const res = await go();
      if (!res.ok) {
        toast(apiErrorMessage(await res.json().catch(() => null), `Couldn't ${label}`), "error");
        return false;
      }
      if (done) toast(done);
      await load();
      return true;
    } catch {
      toast(`Couldn't ${label}`, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const ok = await act(
      "add the account",
      () =>
        fetchWithReauth("/api/accounts", {
          method: "POST",
          ...json({ ...add, id: add.id.trim().toLowerCase() }),
        }),
      `Added ${add.id.trim().toLowerCase()}`
    );
    if (ok) setAdd(emptyAdd);
  }
  function startEdit(a: Account) {
    setEditing(a.id);
    setEdit({ name: a.name, role: a.role, groups: a.groups, requireTwoFactor: a.requireTwoFactor });
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await act(
      "save the account",
      () => fetchWithReauth(`/api/accounts/${editing}`, { method: "PATCH", ...json(edit) }),
      "Account saved"
    );
    if (ok) setEditing(null);
  }
  async function setEnabled(a: Account, enabled: boolean) {
    if (!enabled) {
      const ok = await confirm({
        title: `Disable ${a.name || a.id}?`,
        message: "They are signed out everywhere and can't sign in until enabled again. What they see is kept.",
        confirmLabel: "Disable",
        danger: true,
      });
      if (!ok) return;
    }
    await act(enabled ? "enable the account" : "disable the account", () => fetch(`/api/accounts/${a.id}`, { method: "PATCH", ...json({ enabled }) }));
  }
  async function submitReset(e: FormEvent) {
    e.preventDefault();
    if (!resetting) return;
    const ok = await act(
      "reset the password",
      () => fetchWithReauth(`/api/accounts/${resetting}/password`, { method: "POST", ...json({ password: newPassword }) }),
      "Password reset; they choose their own at the next sign-in"
    );
    if (ok) {
      setResetting(null);
      setNewPassword("");
    }
  }
  async function endSessions(a: Account) {
    await act("sign them out", () => fetch(`/api/accounts/${a.id}/sessions/end`, { method: "POST" }), `${a.name || a.id} signed out everywhere`);
  }
  async function dropTotp(a: Account) {
    const ok = await confirm({
      title: `Turn off two-factor authentication for ${a.name || a.id}?`,
      message: "For someone who lost their authenticator and recovery codes. They can set it up again after signing in.",
      confirmLabel: "Turn off",
      danger: true,
    });
    if (!ok) return;
    await act("turn their second factor off", () => fetchWithReauth(`/api/accounts/${a.id}/totp`, { method: "DELETE" }), "Second factor turned off");
  }
  async function remove(a: Account) {
    const ok = await confirm({
      title: `Remove ${a.name || a.id}?`,
      message: "The account and its sessions go. Boards, apps and bookmarks shared with it stay as they are.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await act("remove the account", () => fetchWithReauth(`/api/accounts/${a.id}`, { method: "DELETE" }), `Removed ${a.id}`);
  }

  // The groups list (#505).
  async function addGroup(e: FormEvent) {
    e.preventDefault();
    const id = newGroup.trim().toLowerCase();
    const ok = await act(
      "add the group",
      () => fetch("/api/account-groups", { method: "POST", ...json({ id }) }),
      `Added the group ${id}`
    );
    if (ok) setNewGroup("");
  }
  // A rename onto a name that's taken asks before merging the two.
  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const from = renaming;
    const to = groupName.trim().toLowerCase();
    const send = (merge: boolean) =>
      fetchWithReauth(`/api/account-groups/${from}`, { method: "PATCH", ...json({ id: to, merge }) });
    setBusy(true);
    let res: Response;
    try {
      res = await send(false);
    } catch {
      toast("Couldn't rename the group", "error");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (res.status === 409) {
      const merge = await confirm({
        title: `Merge ${from} into ${to}?`,
        message: `There's already a group called ${to}. Everyone in ${from} joins it, and everything shared with ${from} is shared with ${to}.`,
        confirmLabel: "Merge",
      });
      if (!merge) return;
      if (await act("merge the groups", () => send(true), `Merged ${from} into ${to}`)) setRenaming(null);
      return;
    }
    if (!res.ok) {
      toast(apiErrorMessage(await res.json().catch(() => null), "Couldn't rename the group"), "error");
      return;
    }
    toast(`Renamed ${from} to ${to}`);
    setRenaming(null);
    await load();
  }
  async function removeGroup(g: GroupUsage) {
    const effects = [
      g.members.length ? `${plural(g.members.length, "account")} leave${g.members.length === 1 ? "s" : ""} it.` : "",
      g.only
        ? `${plural(g.only, "item")} shared with this group alone become${g.only === 1 ? "s" : ""} visible to admins only.`
        : "",
    ].filter(Boolean);
    const ok = await confirm({
      title: `Remove the group ${g.id}?`,
      message: effects.length ? effects.join(" ") : "Nobody is in it and nothing is shared with it.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await act("remove the group", () => fetchWithReauth(`/api/account-groups/${g.id}`, { method: "DELETE" }), `Removed the group ${g.id}`);
  }

  const accounts = listing?.accounts ?? [];
  const groups = listing?.groups ?? [];
  const groupOptions = groups.map((g) => ({ value: g, label: g }));
  // The groups an account is in, picked from the list; how to add one when
  // there are none yet.
  const groupPicker = (label: string, selected: string[], onChange: (next: string[]) => void) => (
    <div className="flex flex-col gap-1.5">
      <span className={fieldLabelClasses}>Groups</span>
      {groups.length ? (
        <ChipToggles label={label} options={groupOptions} selected={selected} onChange={(next) => onChange([...next].sort())} />
      ) : (
        <Hint>No groups yet. Add them under Groups, then pick them here.</Hint>
      )}
    </div>
  );
  return (
    <>
      <Card
        title="Accounts"
        intro="Who can sign in. An admin runs this portal; a member signs in to see the boards, apps and bookmarks shared with them (pick those where each is set) and keeps their own password and second factor at /account."
      >
        {listing === null ? (
          <Hint>Loading accounts…</Hint>
        ) : (
          <ListPanel>
            {accounts.map((a) => {
              const label = a.name || a.id;
              const self = a.id === listing?.current;
              return (
                <div key={a.id} className={`${subCardClasses} flex flex-col gap-2 p-3`}>
                  {editing === a.id ? (
                    <form onSubmit={saveEdit} className="flex flex-col gap-3">
                      <TextField label="Display name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                      <div className="flex flex-wrap gap-3">
                        <label className="flex flex-col gap-1">
                          <span className={fieldLabelClasses}>Role</span>
                          <select
                            value={edit.role}
                            onChange={(e) => setEdit({ ...edit, role: e.target.value === "admin" ? "admin" : "member" })}
                            className={controlClasses}
                            disabled={self}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>
                      </div>
                      {groupPicker(`Groups for ${label}`, edit.groups, (next) => setEdit({ ...edit, groups: next }))}
                      <ToggleRow
                        label="Require two-factor authentication"
                        hint={
                          a.totp
                            ? "They can't turn their second factor off while this is on."
                            : "Until they set it up, signing in takes them to their account page and nowhere else."
                        }
                        checked={edit.requireTwoFactor}
                        onChange={(v) => setEdit({ ...edit, requireTwoFactor: v })}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={busy}>Save</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-medium text-ink-90">{label}</span>
                        <span className="font-mono text-xs text-ink-45">{a.id}</span>
                        <span className="text-xs text-ink-60">{a.role === "admin" ? "Admin" : "Member"}</span>
                        {self && <span className="text-xs text-ink-45">(you)</span>}
                        {!a.enabled && <span className="text-xs text-status-down">Disabled</span>}
                        {a.totp && <span className="text-xs text-ink-60">{a.requireTwoFactor ? "2FA on, required" : "2FA on"}</span>}
                        {!a.totp && a.requireTwoFactor && (
                          <span className="text-xs text-status-warning">Must set up 2FA at sign-in</span>
                        )}
                        {a.mustChangePassword && <span className="text-xs text-ink-60">Must set a password at sign-in</span>}
                      </div>
                      <p className="text-xs text-ink-45">
                        {a.groups.length ? `Groups: ${groupsText(a.groups)} · ` : ""}
                        {a.lastSignInAt ? `Last sign-in ${relativeTime(Date.parse(a.lastSignInAt), now)}` : "Never signed in"}
                        {` · ${a.sessions} session${a.sessions === 1 ? "" : "s"}`}
                      </p>
                      {resetting === a.id ? (
                        <form onSubmit={submitReset} className="flex flex-wrap items-end gap-2">
                          <div className="min-w-0 flex-1 basis-60">
                            <TextField
                              label="New password"
                              type="password"
                              autoComplete="new-password"
                              hint="At least 12 characters. Hand it over; they'll be asked to choose their own at the next sign-in."
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                          </div>
                          <Button type="submit" size="sm" disabled={busy || newPassword.length < 12}>Reset</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setResetting(null); setNewPassword(""); }}>Cancel</Button>
                        </form>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(a)} disabled={busy}>Edit</Button>
                          {!self && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEnabled(a, !a.enabled)} disabled={busy}>
                              {a.enabled ? "Disable" : "Enable"}
                            </Button>
                          )}
                          {!self && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => setResetting(a.id)} disabled={busy}>Reset password</Button>
                          )}
                          {a.sessions > 0 && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => endSessions(a)} disabled={busy}>Sign out everywhere</Button>
                          )}
                          {!self && a.totp && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => dropTotp(a)} disabled={busy}>Turn 2FA off</Button>
                          )}
                          {!self && a.id !== "admin" && (
                            <Button type="button" size="sm" variant="danger" onClick={() => remove(a)} disabled={busy}>Remove</Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </ListPanel>
        )}
      </Card>

      <Card
        title="Groups"
        intro="Share a board, app or bookmark with a group instead of naming each account. Renaming or removing a group here changes it on every account and everything shared with it."
      >
        {listing === null ? (
          <Hint>Loading groups…</Hint>
        ) : (
          <>
            {listing.groupUsage.length > 0 && (
              <ListPanel>
                {listing.groupUsage.map((g) => {
                  const shared = sharedText(g);
                  return (
                    <div key={g.id} className={`${subCardClasses} flex flex-col gap-2 p-3`}>
                      {renaming === g.id ? (
                        <form onSubmit={submitRename} className="flex flex-wrap items-end gap-2">
                          <div className="min-w-0 flex-1 basis-60">
                            <TextField
                              label={`New name for ${g.id}`}
                              hint="Lowercase letters, digits, dots, dashes or underscores. A name that's taken merges the two."
                              autoCapitalize="off"
                              autoComplete="off"
                              spellCheck={false}
                              value={groupName}
                              onChange={(e) => setGroupName(e.target.value)}
                            />
                          </div>
                          <Button type="submit" size="sm" disabled={busy || !groupName.trim() || groupName.trim().toLowerCase() === g.id}>
                            Rename
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                        </form>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="font-medium text-ink-90">{g.id}</span>
                            <span className="text-xs text-ink-60">
                              {g.members.length
                                ? `${plural(g.members.length, "member")}: ${g.members
                                    .map((id) => accounts.find((a) => a.id === id)?.name || id)
                                    .join(", ")}`
                                : "No members"}
                            </span>
                          </div>
                          <p className="text-xs text-ink-45">{shared ? `Shared with it: ${shared}` : "Nothing shared with it yet"}</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRenaming(g.id);
                                setGroupName(g.id);
                              }}
                              disabled={busy}
                            >
                              Rename
                            </Button>
                            <Button type="button" size="sm" variant="danger" onClick={() => removeGroup(g)} disabled={busy}>
                              Remove
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </ListPanel>
            )}
            <form onSubmit={addGroup} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-60">
                <TextField
                  label="New group"
                  hint="e.g. family or ops. Lowercase letters, digits, dots, dashes or underscores."
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" disabled={busy || !newGroup.trim()}>Add group</Button>
            </form>
          </>
        )}
      </Card>

      <Card title="Add an account" intro="A sign-in name, a role and a first password to hand over. They're asked to choose their own password the first time they sign in, unless you turn that off.">
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          {/* One column that shrinks to the card on a phone: the Role
              options are long enough to push it wider otherwise. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Sign-in name"
              hint="Lowercase letters, digits, dots, dashes or underscores; it can't be changed later."
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              required
              value={add.id}
              onChange={(e) => setAdd({ ...add, id: e.target.value })}
            />
            <TextField label="Display name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            <label className="flex min-w-0 flex-col gap-1">
              <span className={fieldLabelClasses}>Role</span>
              <select
                value={add.role}
                onChange={(e) => setAdd({ ...add, role: e.target.value === "admin" ? "admin" : "member" })}
                className={`${controlClasses} min-w-0`}
              >
                <option value="member">Member: sees what is shared with them</option>
                <option value="admin">Admin: everything, this portal included</option>
              </select>
            </label>
            <TextField
              label="First password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters."
              required
              value={add.password}
              onChange={(e) => setAdd({ ...add, password: e.target.value })}
            />
          </div>
          {groupPicker("Groups for the new account", add.groups, (next) => setAdd({ ...add, groups: next }))}
          <ToggleRow
            label="Ask for a new password at the first sign-in"
            hint="Off only when you've agreed the password with them already."
            checked={add.mustChangePassword}
            onChange={(v) => setAdd({ ...add, mustChangePassword: v })}
          />
          <ToggleRow
            label="Require two-factor authentication"
            hint="They set it up at their first sign-in, and can't reach anything else until they have."
            checked={add.requireTwoFactor}
            onChange={(v) => setAdd({ ...add, requireTwoFactor: v })}
          />
          <div>
            <Button type="submit" disabled={busy || add.password.length < 12 || !add.id.trim()}>Add account</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
