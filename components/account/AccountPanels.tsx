"use client";

import { useState } from "react";
import { Button, Card } from "@/components/admin/ui";
import { ToastProvider } from "@/components/admin/Toast";
import { ConfirmProvider } from "@/components/admin/Confirm";
import ChangePassword from "@/components/admin/ChangePassword";
import TwoFactor from "@/components/admin/TwoFactor";
import Sessions from "@/components/admin/Sessions";
import ApiTokens from "@/components/admin/ApiTokens";
import Passkeys from "@/components/admin/Passkeys";
import ReauthDialog from "@/components/admin/ReauthDialog";
import { signOut } from "@/lib/sign-out";

// A signed-in account's own page (#423): its password, its second factor,
// its sessions, and a way out. The same cards the admin's Security section
// uses, which act on the session's own account.
export default function AccountPanels({
  twoFactorEnabled,
  twoFactorRequired = false,
  mustChangePassword,
  isAdmin = false,
}: {
  twoFactorEnabled: boolean;
  // An admin's tokens can be given the actions scope (#538).
  isAdmin?: boolean;
  // An admin requires a second factor of this account (#449): until it has
  // one, this page is the only one it can open.
  twoFactorRequired?: boolean;
  mustChangePassword: boolean;
}) {
  const [twoFactor, setTwoFactor] = useState(twoFactorEnabled);
  return (
    <ToastProvider>
      <ConfirmProvider>
        {/* Making a token asks for the password again (#538). */}
        <ReauthDialog />
        <div className="flex flex-col gap-6">
          {mustChangePassword && (
            <p role="status" className="rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-ink-90">
              The password you signed in with was set for you. Choose your own below before you go on.
            </p>
          )}
          {twoFactorRequired && !twoFactor && (
            <p role="status" className="rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-ink-90">
              An admin requires two-factor authentication for your account. Set it up below; until you do, the rest
              of the site stays closed to you.
            </p>
          )}
          <Card title="Password" intro="The password you sign in with.">
            <ChangePassword own />
          </Card>
          <Card title="Two-factor authentication" intro="Add a time-based code from an authenticator app to your sign-in.">
            <TwoFactor enabled={twoFactor} onChange={setTwoFactor} required={twoFactorRequired} />
          </Card>
          <Card
            title="Passkeys"
            intro="Sign in with your fingerprint, face or device PIN instead of a password and code. A passkey counts as two-factor on its own; your password stays as the way back in."
          >
            <Passkeys />
          </Card>
          <Card title="Sessions" intro="Where your account is signed in. End one you don't recognise, or sign out everywhere else.">
            <Sessions idleControl={false} signIn="/login" />
          </Card>
          <Card
            title="API tokens"
            intro="For a script, Home Assistant or an assistant to read CtrlCenter as you, with “Authorization: Bearer <token>”. A token sees what you see, on the status and Monitor APIs only, and never changes settings or accounts."
          >
            <ApiTokens canAct={isAdmin} />
          </Card>
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
