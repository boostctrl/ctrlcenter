"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, TextField } from "./ui";
import { useFocusTrap } from "./useFocusTrap";
import { apiErrorMessage } from "./apiError";
import { registerReauthPrompt, type ReauthMode } from "./reauth";

// The "Confirm it's you" dialog (#366): mounted once per admin surface, it
// collects the password (and the authenticator code when the second factor
// is on), posts /api/reauth, and resolves the request that opened it so the
// original call retries. Escape or Cancel resolves false.

type Pending = { totpRequired: boolean; mode: ReauthMode; resolve: (ok: boolean) => void };

export default function ReauthDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLFormElement>(pending !== null);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    registerReauthPrompt(
      (totpRequired, mode) =>
        new Promise<boolean>((resolve) => {
          const next = { totpRequired, mode, resolve };
          pendingRef.current = next;
          setPending(next);
          setNeedsCode(totpRequired);
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
            : `This change needs your password${needsCode ? " and an authenticator code" : ""} again, so a session someone else got hold of can't make it.`}
        </p>
        <TextField
          label="Password"
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {needsCode && (
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
          <Button type="submit" disabled={busy}>
            {busy ? (signin ? "Signing in…" : "Confirming…") : signin ? "Sign in" : "Confirm"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => settle(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
