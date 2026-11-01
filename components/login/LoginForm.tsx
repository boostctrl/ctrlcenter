"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { TextField, Button } from "@/components/admin/ui";
import { safeNextPath } from "@/lib/urls";

// The sign-in name last used in this browser (#423), so it needn't be
// retyped; until one is, `admin` while that is the only account (#450),
// nothing once there are more.
const NAME_KEY = "ctrlcenter:signin-name";
const DEFAULT_NAME = "admin";

// `passwordConfigured` and `singleAccount` are decided on the server
// (LoginScreen): with no stored hash and no ADMIN_PASSWORD nobody can sign
// in, so explain that instead of showing a form that can only ever answer
// "Invalid password" (#275). `fallback` is where a sign-in with no `next`
// lands.
export default function LoginForm({
  passwordConfigured,
  singleAccount,
  fallback = "/admin",
}: {
  passwordConfigured: boolean;
  singleAccount: boolean;
  fallback?: string;
}) {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState(singleAccount ? DEFAULT_NAME : "");
  // Focus starts in the password field when the name is known (prefilled
  // or remembered), else in the username field.
  const passwordRef = useRef<HTMLInputElement>(null);
  // Read after mount, not in the initial state: the server renders the
  // default, and a remembered name would otherwise mismatch at hydration.
  useEffect(() => {
    try {
      const remembered = window.localStorage.getItem(NAME_KEY);
      if (remembered) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
        setUsername(remembered);
        passwordRef.current?.focus();
      }
    } catch {
      // Private mode / blocked storage — the default stands.
    }
  }, []);
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
      body: JSON.stringify({ username, password, totp: code }),
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
    try {
      window.localStorage.setItem(NAME_KEY, username.trim().toLowerCase());
    } catch {
      // Not remembered, then.
    }
    // A password an admin set or reset is replaced before anything else
    // (#423): the account page asks for a new one.
    const signedIn = await res.json().catch(() => null);
    if (signedIn?.mustChangePassword) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/account?change=1";
      return;
    }
    // Hard navigation (not router.push): a full document load re-runs the auth
    // middleware with the freshly-set session cookie, so the protected route
    // loads on the first try. A client navigation can resolve against a stale
    // Router Cache entry from before login and bounce back here. Only a path
    // on this origin is followed (#23).
    window.location.assign(
      safeNextPath(searchParams.get("next"), window.location.origin, fallback)
    );
  }

  if (!passwordConfigured) {
    return (
      <div role="alert" className="glass-card flex w-full max-w-sm flex-col gap-3 p-8">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-ink-80">
          No admin password is set, so nobody can sign in yet.
        </p>
        <p className="text-sm text-ink-80">
          Set <code className="whitespace-nowrap rounded bg-fg/10 px-1 py-0.5">ADMIN_PASSWORD</code>{" "}
          in the container&apos;s environment (for example in{" "}
          <code className="whitespace-nowrap rounded bg-fg/10 px-1 py-0.5">docker-compose.yml</code>)
          and restart it. You can change the password from the admin portal
          afterwards.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card flex w-full max-w-sm flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {!needCode ? (
        <>
          <TextField
            label="Username"
            hint={singleAccount ? undefined : <>The founding account is <strong>admin</strong>.</>}
            autoFocus={!singleAccount}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            type="password"
            autoComplete="current-password"
            autoFocus={singleAccount}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      ) : (
        <>
          <p className="text-sm text-ink-60">
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
      {error && <p className="text-sm text-status-down">{error}</p>}
      <Button type="submit" disabled={loading}>
        {loading ? "Signing in..." : needCode ? "Verify" : "Sign in"}
      </Button>
    </form>
  );
}
