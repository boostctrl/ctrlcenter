"use client";

import { useEffect, useState, type FormEvent } from "react";
import { TextField, Button } from "./ui";
import { useToast } from "./Toast";
import { useFocusTrap } from "./useFocusTrap";
import { apiErrorMessage } from "./apiError";

export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const trapRef = useFocusTrap<HTMLFormElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast("New passwords don't match", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Couldn't change password"), "error");
        return;
      }
      toast("Password changed");
      close();
    } catch {
      toast("Couldn't change password", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <span className="text-sm text-fg/70">Admin password</span>
        <p className="text-xs text-fg/40">
          Set a password stored with the app. Until you do, the
          <code className="mx-1 rounded bg-fg/10 px-1">ADMIN_PASSWORD</code>
          environment variable is used.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        Reset password
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={close}
          role="dialog"
          aria-modal="true"
          aria-label="Reset admin password"
        >
          <form
            ref={trapRef}
            onSubmit={handleSubmit}
            onMouseDown={(e) => e.stopPropagation()}
            className="glass-card flex w-full max-w-md flex-col gap-4 p-6 text-left"
          >
            <h3 className="font-semibold">Reset password</h3>
            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <TextField
              label="New password (min 8 characters)"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <TextField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Changing…" : "Change password"}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
