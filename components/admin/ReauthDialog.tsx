"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, TextField } from "./ui";
import { useFocusTrap } from "./useFocusTrap";
import { apiErrorMessage } from "./apiError";
import { registerReauthPrompt } from "./reauth";

// The "Confirm it's you" dialog (#366): mounted once per admin surface, it
// collects the password (and the authenticator code when the second factor
// is on), posts /api/reauth, and resolves the request that opened it so the
// original call retries. Escape or Cancel resolves false.

type Pending = { totpRequired: boolean; resolve: (ok: boolean) => void };

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
      (totpRequired) =>
        new Promise<boolean>((resolve) => {
          const next = { totpRequired, resolve };
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
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reauth", {
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
      setError(apiErrorMessage(data, "Couldn't confirm"));
    } catch {
      setError("Couldn't confirm");
    } finally {
      setBusy(false);
    }
  }

  if (!pending) return null;
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
          Confirm it&apos;s you
        </h3>
        <p className="text-sm text-ink-60">
          This change needs your password{needsCode ? " and an authenticator code" : ""} again,
          so a session someone else got hold of can&apos;t make it.
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
            {busy ? "Confirming…" : "Confirm"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => settle(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
