"use client";

import { useState, Suspense, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { TextField, Button } from "@/components/admin/ui";
import BackHome from "@/components/BackHome";

// Only follow `next` when it's a same-site, same-origin path: a single leading
// slash, not "//" or "/\" (protocol-relative URLs the browser would treat as
// external). Anything else falls back to /admin, so a crafted
// ?next=https://evil.example can't turn login into an open redirect.
function safeNext(next: string | null): string {
  if (next && /^\/(?![/\\])/.test(next)) return next;
  return "/admin";
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // The password checked out and the server is asking for the second factor
  // (#198): swap the form to the code step, keeping the password to resend.
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, totp: code }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // A 429 carries Retry-After (seconds); turn the lockout into an
      // instruction instead of the body's bare "try again later".
      const retryAfter = Number(res.headers.get("Retry-After"));
      if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
        const minutes = Math.ceil(retryAfter / 60);
        setError(
          `Too many attempts. Try again in ${
            minutes === 1 ? "1 minute" : `${minutes} minutes`
          }.`
        );
        return;
      }
      if (data?.totpRequired) {
        // Password was accepted; move to (or stay on) the code step. Only
        // surface an error once the admin has actually submitted a code.
        setNeedCode(true);
        setError(code.trim() === "" ? null : data?.error || "Invalid code");
        return;
      }
      setError(data?.error || "Incorrect password");
      return;
    }
    // Hard navigation (not router.push): a full document load re-runs the auth
    // middleware with the freshly-set session cookie, so the protected route
    // loads on the first try. A client navigation can resolve against a stale
    // Router Cache entry from before login and bounce back here.
    window.location.assign(safeNext(searchParams.get("next")));
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card flex w-full max-w-sm flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {!needCode ? (
        <TextField
          label="Password"
          type="password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      ) : (
        <>
          <p className="text-sm text-fg/60">
            Enter the 6-digit code from your authenticator app, or a recovery
            code.
          </p>
          <TextField
            label="Authentication code"
            autoFocus
            required
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={loading}>
        {loading ? "Signing in..." : needCode ? "Verify" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
      <BackHome />
    </main>
  );
}
