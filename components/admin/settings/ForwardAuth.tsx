"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Hint, TextField, ToggleRow } from "../ui";
import { useToast } from "../Toast";
import { apiErrorMessage } from "../apiError";
import { fetchWithReauth } from "../reauth";
import type { ForwardAuthConfig } from "@/lib/schema/sign-in";

// Settings → Users → Sign in through the reverse proxy (#504): a
// forward-auth proxy (Authelia, Authentik, oauth2-proxy) signs people in
// and passes who they are in headers. Believed only from the proxy's own
// addresses, which the card helps find: it shows the address this page
// came from, and who the proxy says this is. Saved with its own button,
// behind a confirmation.
type Proxy = { peer: string | null; productionEntry: boolean; fromProxy: boolean; seen: string | null };
type Loaded = { forwardAuth: ForwardAuthConfig; proxy: Proxy };

const listOf = (text: string) => text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

export default function ForwardAuth() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<ForwardAuthConfig | null>(null);
  const [proxies, setProxies] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const res = await fetch("/api/sign-in").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as Loaded;
    setLoaded(data);
    setDraft(data.forwardAuth);
    setProxies(data.forwardAuth.proxies.join(", "));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read after mount
    void load();
  }, [load]);

  if (!loaded || !draft) {
    return (
      <Card title="Sign in through the reverse proxy">
        <Hint>Loading…</Hint>
      </Card>
    );
  }
  const set = (patch: Partial<ForwardAuthConfig>) => setDraft({ ...draft, ...patch });
  const next = { ...draft, proxies: listOf(proxies) };
  const dirty = JSON.stringify(next) !== JSON.stringify(loaded.forwardAuth);
  const { peer, productionEntry, fromProxy, seen } = loaded.proxy;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchWithReauth("/api/sign-in", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forwardAuth: next }),
      });
      if (!res.ok) {
        toast(apiErrorMessage(await res.json().catch(() => null), "Couldn't save"), "error");
        return;
      }
      await load();
      toast("Saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Sign in through the reverse proxy"
      intro="For a reverse proxy that signs people in itself (Authelia, Authentik, oauth2-proxy) and passes who they are in headers. A page load signs in to the account of that name, with the proxy's groups that are on the list above."
    >
      <form onSubmit={save} className="flex flex-col gap-3">
        <ToggleRow
          label="Sign in from the proxy's headers"
          checked={draft.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <div className="text-xs text-ink-60" role="status">
          {!productionEntry ? (
            <p>
              Outside the Docker image, CtrlCenter can&apos;t see which address a request came from, so the headers are
              never believed.
            </p>
          ) : (
            <p>
              This page reached CtrlCenter from <code className="font-mono">{peer ?? "an unknown address"}</code>
              {fromProxy ? ", one of the proxy addresses below." : "."}
              {seen ? (
                <>
                  {" "}
                  The proxy says this is <strong>{seen}</strong>.
                </>
              ) : null}
            </p>
          )}
        </div>
        <TextField
          label="Proxy addresses"
          placeholder="172.18.0.2, 10.0.0.0/24"
          hint="The addresses your reverse proxy connects from, or ranges. The headers are believed from these only, so nobody who reaches CtrlCenter another way can send them."
          autoCapitalize="off"
          spellCheck={false}
          value={proxies}
          onChange={(e) => setProxies(e.target.value)}
        />
        {productionEntry && peer && !listOf(proxies).includes(peer) && (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setProxies([...listOf(proxies), peer].join(", "))}>
              Use {peer}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="User header"
            placeholder="Remote-User"
            hint="Your proxy must set or remove it on every request it passes on, including paths it lets through without signing in; otherwise anyone could send their own through it."
            value={draft.userHeader}
            onChange={(e) => set({ userHeader: e.target.value })}
          />
          <TextField
            label="Groups header"
            placeholder="Remote-Groups"
            hint="Blank to ignore the proxy's groups."
            value={draft.groupsHeader}
            onChange={(e) => set({ groupsHeader: e.target.value })}
          />
        </div>
        <ToggleRow
          label="Make an account for a new name"
          hint="Off: only accounts added here can sign in this way. On: anyone the proxy lets through gets a member account."
          checked={draft.createAccounts}
          onChange={(createAccounts) => set({ createAccounts })}
        />
        <ToggleRow
          label="The proxy requires two-factor authentication"
          hint="The headers can't say whether the proxy asked for a second factor. Turn this on when its policy does, for everyone; otherwise an account with its own second factor enters that code too."
          checked={draft.enforcesTwoFactor}
          onChange={(enforcesTwoFactor) => set({ enforcesTwoFactor })}
        />
        <TextField
          label="Sign-out address"
          placeholder="https://auth.example.com/logout"
          hint="Where signing out sends the browser, to sign out of the proxy too. Blank: signing out here only, and the headers don't sign anyone back in until they choose to continue."
          autoCapitalize="off"
          spellCheck={false}
          value={draft.logoutUrl}
          onChange={(e) => set({ logoutUrl: e.target.value })}
        />
        <div>
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
