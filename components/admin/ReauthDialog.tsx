"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, TextField } from "./ui";
import { useFocusTrap } from "./useFocusTrap";
import { apiErrorMessage } from "./apiError";
import { registerReauthPrompt, type ReauthMode, type ReauthOptions } from "./reauth";
import { oidcFailureMessage, providerPopup } from "@/lib/oidc-messages";

// The "Confirm it's you" dialog (#366): mounted once per admin surface, it
// collects the password (and the authenticator code when the second factor
// is on), posts /api/reauth, and resolves the request that opened it so the
// original call retries. Escape or Cancel resolves false.

type Pending = { totpRequired: boolean; mode: ReauthMode; options: ReauthOptions; resolve: (ok: boolean) => void };

export default function ReauthDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The provider's button (#504): "Confirm with Nextcloud" for a session
  // that came from it; "Sign in with Nextcloud" when the session ended and
  // the sign-in page offers it.
  const [providerButton, setProviderButton] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLFormElement>(pending !== null);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    registerReauthPrompt(
      (totpRequired, mode, options) =>
        new Promise<boolean>((resolve) => {
          const next = { totpRequired, mode, options, resolve };
          pendingRef.current = next;
          setPending(next);
          setNeedsCode(totpRequired);
          setProviderButton(options.provider ? `Confirm with ${options.provider}` : null);
          if (mode === "signin") {
            void fetch("/api/auth/providers")
              .then((r) => (r.ok ? r.json() : null))
              .then((d: { oidc?: { label?: string } | null } | null) => setProviderButton(d?.oidc?.label ?? null))
              .catch(() => {});
          }
        })
    );
    return () => registerReauthPrompt(null);
  }, []);

  function settle(ok: boolean) {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
    setPassword("");
    setCode("");
    setError(null);
    setBusy(false);
    setProviderButton(null);
  }

  // Through the provider, in a popup: a fresh sign-in there confirms this
  // session, or starts a new one when it ended.
  async function viaProvider() {
    const signin = pendingRef.current?.mode === "signin";
    setBusy(true);
    setError(null);
    const result = await providerPopup(signin ? "signin" : "reauth");
    if (result.ok) {
      settle(true);
      return;
    }
    setBusy(false);
    if (result.error === "closed") return;
    setError(
      result.error === "blocked"
        ? "The provider's window couldn't open. Allow pop-ups for this site and try again."
        : oidcFailureMessage(result.error)
    );
  }

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const signin = pendingRef.current?.mode === "signin";
    setBusy(true);
    setError(null);
    try {
      // A sign-in takes the same body as a confirmation (#399).
      const res = await fetch(signin ? "/api/login" : "/api/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(code ? { totp: code } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; totpRequired?: boolean }
        | null;
      if (res.ok) {
        settle(true);
        return;
      }
      if (data?.totpRequired) setNeedsCode(true);
      setError(apiErrorMessage(data, signin ? "Couldn't sign in" : "Couldn't confirm"));
    } catch {
      setError(signin ? "Couldn't sign in" : "Couldn't confirm");
    } finally {
      setBusy(false);
    }
  }

  if (!pending) return null;
  const signin = pending.mode === "signin";
  // An account a provider made has no password to confirm with (#504).
  const withPassword = pending.options.password !== false;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={() => settle(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-title"
    >
      <form
        ref={trapRef}
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass-card flex w-full max-w-md flex-col gap-4 p-6 text-left"
      >
        <h3 id="reauth-title" className="font-semibold">
          {signin ? "Your session ended" : "Confirm it's you"}
        </h3>
        <p className="text-sm text-ink-60">
          {signin
            ? `Sign in again to keep working. What you were editing is still here and saves once you're back in${needsCode ? "; you'll need your authenticator code too" : ""}.`
            : pending.options.provider
              ? `This change needs you to sign in again${withPassword ? `, through ${pending.options.provider} or with your password` : ` through ${pending.options.provider}`}, so a session someone else got hold of can't make it.`
              : `This change needs your password${needsCode ? " and an authenticator code" : ""} again, so a session someone else got hold of can't make it.`}
        </p>
        {providerButton && (
          <Button type="button" onClick={() => void viaProvider()} disabled={busy}>
            {providerButton}
          </Button>
        )}
        {providerButton && withPassword && <p className="text-center text-xs text-ink-45">or with your password</p>}
        {withPassword && (
        <TextField
          label="Password"
          type="password"
          autoFocus={!providerButton}
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        )}
        {withPassword && needsCode && (
          <TextField
            label="Authentication code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
        {error && <p className="text-sm text-status-down">{error}</p>}
        <div className="flex gap-2">
          {withPassword && (
            <Button type="submit" variant={providerButton ? "ghost" : undefined} disabled={busy}>
              {busy ? (signin ? "Signing in…" : "Confirming…") : signin ? "Sign in" : "Confirm"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => settle(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
