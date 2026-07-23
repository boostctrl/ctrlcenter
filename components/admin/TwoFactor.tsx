"use client";

import { useEffect, useState, type FormEvent } from "react";
import { TextField, Button } from "./ui";
import { useToast } from "./Toast";
import { useFocusTrap } from "./useFocusTrap";
import { apiErrorMessage } from "./apiError";

// The admin Security section's two-factor card (#198). Opt-in TOTP: enroll by
// scanning a QR (or entering the secret) and confirming a code, which then
// reveals one-time recovery codes; disable by confirming a current code.
// Existing password-only setups see only the "Enable" affordance.

type SetupData = { secret: string; qr: string };
// "enroll" collects the confirmation code against a fresh secret; "recovery"
// shows the one-time codes after activation; "disable" confirms a code to turn
// 2FA off.
type Step = "enroll" | "recovery" | "disable";

// Group the base32 secret into fours for legible manual entry.
const formatSecret = (secret: string) =>
  secret.match(/.{1,4}/g)?.join(" ") ?? secret;

export default function TwoFactor({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<Step | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const open = step !== null;
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't let Escape abandon the recovery-code screen — the codes won't be
      // shown again, so require an explicit acknowledgement.
      if (e.key === "Escape" && step !== "recovery") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step]);

  function close() {
    setStep(null);
    setSetup(null);
    setRecoveryCodes([]);
    setCode("");
    setError(null);
    setBusy(false);
  }

  async function startEnroll() {
    setBusy(true);
    setError(null);
    setStep("enroll");
    try {
      const res = await fetch("/api/2fa/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(apiErrorMessage(data, "Couldn't start setup"), "error");
        close();
        return;
      }
      setSetup({ secret: data.secret, qr: data.qr });
    } catch {
      toast("Couldn't start setup", "error");
      close();
    } finally {
      setBusy(false);
    }
  }

  async function activate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/2fa/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(data, "Couldn't activate"));
        return;
      }
      setRecoveryCodes(data.recoveryCodes ?? []);
      setCode("");
      setStep("recovery");
    } catch {
      setError("Couldn't activate");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(data, "Couldn't disable"));
        return;
      }
      setEnabled(false);
      toast("Two-factor authentication disabled");
      close();
    } catch {
      setError("Couldn't disable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <span className="text-sm text-fg/70">Two-factor authentication</span>
        <p className="text-xs text-fg/40">
          {enabled
            ? "On — a code from your authenticator app is required at sign-in."
            : "Require a time-based code from an authenticator app in addition to your password."}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="shrink-0"
        onClick={() => (enabled ? setStep("disable") : startEnroll())}
      >
        {enabled ? "Disable" : "Enable"}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
          onMouseDown={() => step !== "recovery" && close()}
          role="dialog"
          aria-modal="true"
          aria-label="Two-factor authentication"
        >
          <div
            ref={trapRef}
            onMouseDown={(e) => e.stopPropagation()}
            className="glass-card flex w-full max-w-md flex-col gap-4 p-6 text-left"
          >
            {step === "enroll" && (
              <form onSubmit={activate} className="flex flex-col gap-4">
                <h3 className="font-semibold">Set up two-factor authentication</h3>
                <p className="text-sm text-fg/60">
                  Scan this QR code with your authenticator app, or enter the
                  secret manually, then type the 6-digit code it shows.
                </p>
                {setup ? (
                  <>
                    <div className="flex justify-center">
                      {/* Server-generated PNG data-URI (qrcode); img-src allows data:. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={setup.qr}
                        alt="Two-factor QR code"
                        width={200}
                        height={200}
                        className="rounded-lg bg-white p-2"
                      />
                    </div>
                    <p className="text-center text-xs tracking-wider text-fg/50 select-all">
                      {formatSecret(setup.secret)}
                    </p>
                    <TextField
                      label="6-digit code"
                      autoFocus
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    <div className="flex gap-2">
                      <Button type="submit" disabled={busy}>
                        {busy ? "Verifying…" : "Activate"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={close}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-fg/40">Preparing…</p>
                )}
              </form>
            )}

            {step === "recovery" && (
              <div className="flex flex-col gap-4">
                <h3 className="font-semibold">Save your recovery codes</h3>
                <p className="text-sm text-fg/60">
                  Each code works once, to sign in if you lose your
                  authenticator. Store them somewhere safe — they won&apos;t be
                  shown again.
                </p>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-fg/10 bg-fg/5 p-4 font-mono text-sm">
                  {recoveryCodes.map((rc) => (
                    <li key={rc} className="select-all tabular-nums">
                      {rc}
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  onClick={() => {
                    setEnabled(true);
                    toast("Two-factor authentication enabled");
                    close();
                  }}
                >
                  I&apos;ve saved my recovery codes
                </Button>
              </div>
            )}

            {step === "disable" && (
              <form onSubmit={disable} className="flex flex-col gap-4">
                <h3 className="font-semibold">Turn off two-factor authentication</h3>
                <p className="text-sm text-fg/60">
                  Enter a current authenticator code (or a recovery code) to
                  confirm.
                </p>
                <TextField
                  label="Authentication code"
                  autoFocus
                  required
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Disabling…" : "Disable"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
