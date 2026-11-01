"use client";

import { useState } from "react";
import { Button, Card } from "@/components/admin/ui";
import { ToastProvider } from "@/components/admin/Toast";
import { ConfirmProvider } from "@/components/admin/Confirm";
import ChangePassword from "@/components/admin/ChangePassword";
import TwoFactor from "@/components/admin/TwoFactor";
import Sessions from "@/components/admin/Sessions";

// A signed-in account's own page (#423): its password, its second factor,
// its sessions, and a way out. The same cards the admin's Security section
// uses, which act on the session's own account.
export default function AccountPanels({
  twoFactorEnabled,
  mustChangePassword,
}: {
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
}) {
  const [twoFactor, setTwoFactor] = useState(twoFactorEnabled);
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex flex-col gap-6">
          {mustChangePassword && (
            <p role="status" className="rounded-xl border border-status-warn/40 bg-status-warn/10 px-4 py-3 text-sm text-ink-90">
              The password you signed in with was set for you. Choose your own below before you go on.
            </p>
          )}
          <Card title="Password" intro="The password you sign in with.">
            <ChangePassword own />
          </Card>
          <Card title="Two-factor authentication" intro="Add a time-based code from an authenticator app to your sign-in.">
            <TwoFactor enabled={twoFactor} onChange={setTwoFactor} />
          </Card>
          <Card title="Sessions" intro="Where your account is signed in. End one you don't recognise, or sign out everywhere else.">
            <Sessions idleControl={false} signIn="/login" />
          </Card>
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" }).catch(() => {});
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = "/";
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
