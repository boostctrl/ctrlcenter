"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Hint, ListPanel, TextField, ToggleRow, controlClasses, fieldLabelClasses, subCardClasses } from "../ui";
import { useToast } from "../Toast";
import { useConfirm } from "../Confirm";
import { apiErrorMessage } from "../apiError";
import { fetchWithReauth } from "../reauth";
import { forgetAccounts } from "../AudiencePicker";
import { relativeTime } from "@/components/StatusTimeline";

// Settings → Users (#423): every account, with what it is and what it holds,
// and the admin's work on it — add, rename, change role and groups, enable
// or disable, reset the password, sign out everywhere, drop a lost second
// factor, remove. The steps that open a way in confirm the admin's password
// first (fetchWithReauth).
type Account = {
  id: string;
  name: string;
  role: "admin" | "member";
  enabled: boolean;
  groups: string[];
  totp: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastSignInAt: string;
  sessions: number;
};
type Listing = { accounts: Account[]; groups: string[]; current: string };

const groupsText = (groups: string[]) => groups.join(", ");
const parseGroups = (text: string) =>
  [...new Set(text.split(/[\s,]+/).map((g) => g.trim().toLowerCase()).filter(Boolean))];

const emptyAdd = { id: "", name: "", role: "member" as "admin" | "member", groups: "", password: "", mustChangePassword: true };

export default function UsersSection() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [add, setAdd] = useState(emptyAdd);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", role: "member" as "admin" | "member", groups: "" });
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
          ...json({ ...add, id: add.id.trim().toLowerCase(), groups: parseGroups(add.groups) }),
        }),
      `Added ${add.id.trim().toLowerCase()}`
    );
    if (ok) setAdd(emptyAdd);
  }
  function startEdit(a: Account) {
    setEditing(a.id);
    setEdit({ name: a.name, role: a.role, groups: groupsText(a.groups) });
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await act(
      "save the account",
      () => fetchWithReauth(`/api/accounts/${editing}`, { method: "PATCH", ...json({ ...edit, groups: parseGroups(edit.groups) }) }),
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

  const accounts = listing?.accounts ?? [];
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
                        <div className="min-w-0 flex-1 basis-60">
                          <TextField
                            label="Groups"
                            hint="Comma-separated, e.g. family, ops. A board or item can be shared with a whole group."
                            value={edit.groups}
                            onChange={(e) => setEdit({ ...edit, groups: e.target.value })}
                          />
                        </div>
                      </div>
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
                        {a.totp && <span className="text-xs text-ink-60">2FA on</span>}
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

      <Card title="Add an account" intro="A sign-in name, a role and a first password to hand over. They're asked to choose their own password the first time they sign in, unless you turn that off.">
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
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
            <label className="flex flex-col gap-1">
              <span className={fieldLabelClasses}>Role</span>
              <select
                value={add.role}
                onChange={(e) => setAdd({ ...add, role: e.target.value === "admin" ? "admin" : "member" })}
                className={controlClasses}
              >
                <option value="member">Member: sees what is shared with them</option>
                <option value="admin">Admin: everything, this portal included</option>
              </select>
            </label>
            <TextField
              label="Groups"
              hint="Comma-separated, e.g. family, ops."
              value={add.groups}
              onChange={(e) => setAdd({ ...add, groups: e.target.value })}
            />
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
          <ToggleRow
            label="Ask for a new password at the first sign-in"
            hint="Off only when you've agreed the password with them already."
            checked={add.mustChangePassword}
            onChange={(v) => setAdd({ ...add, mustChangePassword: v })}
          />
          <div>
            <Button type="submit" disabled={busy || add.password.length < 12 || !add.id.trim()}>Add account</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
