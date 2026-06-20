"use client";

import { useState, type FormEvent } from "react";
import { TextField, Button } from "./ui";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";

export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

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
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      toast("Couldn't change password", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-card flex max-w-xl flex-col gap-4 p-6"
    >
      <div>
        <h3 className="font-semibold">Change password</h3>
        <p className="text-xs text-white/40">
          Sets a password stored with the app. Until you set one, the
          <code className="mx-1 rounded bg-white/10 px-1">ADMIN_PASSWORD</code>
          environment variable is used.
        </p>
      </div>
      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
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
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
