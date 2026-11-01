"use client";

import { useEffect, useState } from "react";
import type { Audience } from "@/lib/schema";

// Who else may see a private board, app or bookmark (#423): the member
// accounts and the groups to tick. Admins see everything, so they aren't
// listed. An empty choice reports null, so nothing is stored for "admins
// only". The accounts come from GET /api/accounts, read once per page.
type Listing = { accounts: { id: string; name: string; role: string; enabled: boolean; groups: string[] }[]; groups: string[] };

let listing: Promise<Listing | null> | null = null;
function loadListing(): Promise<Listing | null> {
  listing ??= fetch("/api/accounts")
    .then((res) => (res.ok ? (res.json() as Promise<Listing>) : null))
    .catch(() => null);
  return listing;
}
// Tests, and a page that just added an account, start the next read fresh.
export function forgetAccounts(): void {
  listing = null;
}

const toggled = (list: string[] | undefined, id: string, on: boolean): string[] => {
  const next = (list ?? []).filter((x) => x !== id);
  return on ? [...next, id].sort() : next;
};

export default function AudiencePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: Audience | undefined | null;
  onChange: (audience: Audience | null) => void;
  idPrefix: string;
}) {
  const [data, setData] = useState<Listing | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadListing().then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, []);
  const users = value?.users ?? [];
  const groups = value?.groups ?? [];
  // Only the lists that name someone, so nothing is stored for "admins only".
  const emit = (next: Audience) => {
    const trimmed: Audience = {
      ...(next.users?.length ? { users: next.users } : {}),
      ...(next.groups?.length ? { groups: next.groups } : {}),
    };
    onChange(trimmed.users || trimmed.groups ? trimmed : null);
  };
  const members = data?.accounts.filter((a) => a.role !== "admin") ?? [];
  const known = data?.groups ?? [];

  return (
    <fieldset className="space-y-2">
      <legend className="text-[11px] font-medium text-ink-55">Also visible to</legend>
      {data === undefined ? (
        <p className="text-[10px] text-ink-40">Loading accounts…</p>
      ) : members.length === 0 && known.length === 0 ? (
        <p className="text-[10px] text-ink-40">
          No member accounts yet, so only admins can see this. Members and groups appear here once there are some.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {members.map((a) => {
            const id = `${idPrefix}-user-${a.id}`;
            return (
              <label key={a.id} htmlFor={id} className="flex items-center gap-1.5 text-xs text-ink-70">
                <input
                  id={id}
                  type="checkbox"
                  checked={users.includes(a.id)}
                  onChange={(e) => emit({ users: toggled(users, a.id, e.target.checked), groups })}
                />
                {a.name || a.id}
                {!a.enabled && <span className="text-ink-40">(disabled)</span>}
              </label>
            );
          })}
          {known.map((g) => {
            const id = `${idPrefix}-group-${g}`;
            return (
              <label key={g} htmlFor={id} className="flex items-center gap-1.5 text-xs text-ink-70">
                <input
                  id={id}
                  type="checkbox"
                  checked={groups.includes(g)}
                  onChange={(e) => emit({ users, groups: toggled(groups, g, e.target.checked) })}
                />
                <span className="text-ink-40">group</span> {g}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
