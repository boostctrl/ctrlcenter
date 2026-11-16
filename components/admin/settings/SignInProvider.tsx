"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Hint, TextField, ToggleRow } from "../ui";
import { useToast } from "../Toast";
import { apiErrorMessage } from "../apiError";
import { fetchWithReauth } from "../reauth";
import { CopyUrlField } from "../CopyUrlField";
import { OIDC_DEFAULT_SCOPES, type OidcConfig } from "@/lib/schema/sign-in";

// Settings → Users → Sign in with a provider (#504): an OpenID Connect
// provider beside the password form — Nextcloud's OIDC Identity Provider
// app, Authentik, Authelia, Pocket ID. Saved with its own button, not the
// autosave: it opens a way in, so the save asks for the password again.
type Loaded = { oidc: OidcConfig; redirectUri: string; secretFromEnv: boolean; check?: { ok: boolean; error?: string } };

export default function SignInProvider() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<OidcConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Loaded["check"] | null>(null);
  const toast = useToast();

  const load = useCallback(async (withCheck = false) => {
    const res = await fetch(`/api/sign-in${withCheck ? "?check=1" : ""}`).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json()) as Loaded;
    setLoaded(data);
    return data;
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read after mount
    void load().then((d) => {
      if (d) setDraft(d.oidc);
    });
  }, [load]);

  if (!loaded || !draft) {
    return (
      <Card title="Sign in with a provider">
        <Hint>Loading…</Hint>
      </Card>
    );
  }
  const set = (patch: Partial<OidcConfig>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.oidc);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetchWithReauth("/api/sign-in", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oidc: draft }),
      });
      if (!res.ok) {
        toast(apiErrorMessage(await res.json().catch(() => null), "Couldn't save the sign-in provider"), "error");
        return;
      }
      const fresh = await load();
      if (fresh) setDraft(fresh.oidc);
      setCheck(null);
      toast("Sign-in provider saved");
    } finally {
      setBusy(false);
    }
  }
  async function runCheck() {
    setBusy(true);
    try {
      setCheck((await load(true))?.check ?? { ok: false, error: "Couldn't ask the server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Sign in with a provider"
      intro="Offer a “Sign in with …” button beside the password form, through an OpenID Connect provider such as Nextcloud's OIDC Identity Provider app. It signs people in to the accounts here, matched by sign-in name; the provider's groups that are on the list above count too."
    >
      <form onSubmit={save} className="flex flex-col gap-3">
        <ToggleRow
          label="Offer sign-in through the provider"
          checked={draft.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <CopyUrlField
          label="Redirect address to register with the provider"
          ariaLabel="Copy the redirect address"
          url={loaded.redirectUri}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Button name"
            placeholder="Nextcloud"
            hint="The button says “Sign in with” this."
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
          />
          <TextField
            label="Issuer"
            placeholder="https://cloud.example.com"
            hint="The provider's address; for Nextcloud, its own address."
            autoCapitalize="off"
            spellCheck={false}
            value={draft.issuer}
            onChange={(e) => set({ issuer: e.target.value })}
          />
          <TextField
            label="Client ID"
            autoCapitalize="off"
            spellCheck={false}
            value={draft.clientId}
            onChange={(e) => set({ clientId: e.target.value })}
          />
          <TextField
            label="Client secret"
            type="password"
            autoComplete="new-password"
            hint={
              loaded.secretFromEnv
                ? "CTRLCENTER_OIDC_CLIENT_SECRET is set, and is used instead."
                : "Stored encrypted. Leave as is to keep it."
            }
            value={draft.clientSecret}
            onChange={(e) => set({ clientSecret: e.target.value })}
          />
        </div>
        <ToggleRow
          label="Make an account for a new name"
          hint="Off: only accounts added here can sign in. On: anyone the provider signs in gets a member account on first sign-in, so limit who the provider lets use this client."
          checked={draft.createAccounts}
          onChange={(createAccounts) => set({ createAccounts })}
        />
        <ToggleRow
          label="The provider requires two-factor authentication"
          hint="Counts the provider's sign-in as two-factor here. Nextcloud doesn't say whether it used one, so turn this on only when it enforces two-factor for everyone; otherwise an account with its own second factor enters that code too."
          checked={draft.enforcesTwoFactor}
          onChange={(enforcesTwoFactor) => set({ enforcesTwoFactor })}
        />
        <ToggleRow
          label="Signing out here also signs out of the provider"
          checked={draft.endProviderSession}
          onChange={(endProviderSession) => set({ endProviderSession })}
        />
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-60">Claims and scopes</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField
              label="Scopes"
              placeholder={OIDC_DEFAULT_SCOPES}
              value={draft.scopes}
              onChange={(e) => set({ scopes: e.target.value })}
            />
            <TextField
              label="Sign-in name claim"
              placeholder="preferred_username"
              value={draft.usernameClaim}
              onChange={(e) => set({ usernameClaim: e.target.value })}
            />
            <TextField
              label="Groups claim"
              placeholder="groups"
              hint="Blank to ignore the provider's groups."
              value={draft.groupsClaim}
              onChange={(e) => set({ groupsClaim: e.target.value })}
            />
          </div>
        </details>
        {check && (
          <p role="status" className={`text-xs ${check.ok ? "text-status-up" : "text-status-down"}`}>
            {check.ok ? "The provider answered." : `The provider didn't answer: ${check.error ?? "unknown error"}`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void runCheck()} disabled={busy || dirty || !loaded.oidc.issuer}>
            Check the provider
          </Button>
        </div>
      </form>
    </Card>
  );
}
