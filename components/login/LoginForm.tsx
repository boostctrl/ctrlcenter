"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { TextField, Button } from "@/components/admin/ui";
import { safeNextPath } from "@/lib/urls";
import { buttonClasses } from "@/lib/buttons";
import { oidcFailureMessage } from "@/lib/oidc-messages";

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
  provider = null,
  forwardUser = null,
}: {
  passwordConfigured: boolean;
  singleAccount: boolean;
  fallback?: string;
  // The provider's button (#504): "Sign in with Nextcloud", or null.
  provider?: string | null;
  // Who the reverse proxy says this is (#504), to continue as; or null.
  forwardUser?: string | null;
}) {
  const searchParams = useSearchParams();
  // Back from the provider with the account's own second factor to enter
  // (#504): that step alone.
  if (searchParams.get("code") === "provider") return <ProviderCodeForm fallback={fallback} />;
  return (
    <PasswordForm
      passwordConfigured={passwordConfigured}
      singleAccount={singleAccount}
      fallback={fallback}
      provider={provider}
      forwardUser={forwardUser}
    />
  );
}

function PasswordForm({
  passwordConfigured,
  singleAccount,
  fallback,
  provider,
  forwardUser,
}: {
  passwordConfigured: boolean;
  singleAccount: boolean;
  fallback: string;
  provider: string | null;
  forwardUser: string | null;
}) {
  const searchParams = useSearchParams();
  // Back from the provider without a session: why (#504).
  const providerError = searchParams.get("error") ? oidcFailureMessage(searchParams.get("error"), searchParams.get("name")) : null;
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
    let res: Response;
    try {
      res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, totp: code }),
      });
    } catch {
      // The request never got an answer (the server restarting, the network
      // gone): say so rather than leave the button on "Signing in…" (#462).
      setLoading(false);
      setError("Couldn't reach CtrlCenter. Check the connection and try again.");
      return;
    }
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
    // (#423), and a second factor an admin requires is set up (#449): the
    // account page asks for both.
    const signedIn = await res.json().catch(() => null);
    if (signedIn?.mustChangePassword || signedIn?.mustSetUpTwoFactor) {
      window.location.href = signedIn.mustChangePassword ? "/account?change=1" : "/account";
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
      {!error && providerError && (
        <p role="alert" className="text-sm text-status-down">
          {providerError}
        </p>
      )}
      <Button type="submit" disabled={loading}>
        {loading ? "Signing in..." : needCode ? "Verify" : "Sign in"}
      </Button>
      {(provider || forwardUser) && !needCode && <p className="text-center text-xs text-ink-45">or</p>}
      {forwardUser && !needCode && (
        <a
          href={`/api/auth/forward${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next") ?? "")}` : ""}`}
          className={`${buttonClasses("ghost")} text-center`}
        >
          Continue as {forwardUser}
        </a>
      )}
      {provider && !needCode && (
        <a
          href={`/api/auth/oidc/start${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next") ?? "")}` : ""}`}
          className={`${buttonClasses("ghost")} text-center`}
        >
          {provider}
        </a>
      )}
    </form>
  );
}

// The second step of a provider sign-in (#504): the provider vouched for
// who it is, and the account's own authenticator code (or a recovery code)
// finishes it. In a popup, the page that opened it is told and the popup
// closes; else on to where the sign-in was going.
function ProviderCodeForm({ fallback }: { fallback: string }) {
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp: code }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; expired?: boolean; next?: string; popup?: boolean } | null;
      if (!res.ok) {
        setExpired(data?.expired === true);
        setError(data?.error || "Invalid code");
        return;
      }
      if (data?.popup) {
        const message = { type: "ctrlcenter:oidc", ok: true };
        try {
          new BroadcastChannel("ctrlcenter-oidc").postMessage(message);
        } catch {
          // postMessage alone, then.
        }
        window.opener?.postMessage(message, window.location.origin);
        window.close();
        return;
      }
      window.location.assign(safeNextPath(data?.next ?? searchParams.get("next"), window.location.origin, fallback));
    } catch {
      setError("Couldn't reach CtrlCenter. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card flex w-full max-w-sm flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="text-sm text-ink-60">
        Signed in through the provider. Your account here also has two-factor authentication: enter the 6-digit code
        from your authenticator app, or a recovery code.
      </p>
      <TextField
        label="Authentication code"
        autoFocus
        required
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {error && <p className="text-sm text-status-down">{error}</p>}
      {expired ? (
        <a href="/login" className={`${buttonClasses("ghost")} text-center`}>
          Start again
        </a>
      ) : (
        <Button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Verify"}
        </Button>
      )}
    </form>
  );
}
