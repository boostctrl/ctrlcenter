"use client";

import { useState } from "react";
import { Card } from "../ui";
import ChangePassword from "../ChangePassword";
import TwoFactor from "../TwoFactor";
import Sessions from "../Sessions";
import SecurityChecklist from "../SecurityChecklist";
import SecurityActivity from "../SecurityActivity";

export default function SecuritySection({
  twoFactorEnabled,
  onTwoFactorChange,
}: {
  // Held by SettingsManager (#384): this section unmounts on every switch,
  // and Integrations reads the same value.
  twoFactorEnabled: boolean;
  onTwoFactorChange: (enabled: boolean) => void;
}) {
  // Bumped when the second factor turns on or off, so the checklist re-reads.
  const [version, setVersion] = useState(0);
  return (
    <>
      <Card
        title="Checklist"
        intro="What this deployment looks like from the app's side. Clear the red rows before putting the portal on a public port."
      >
        <SecurityChecklist version={version} />
      </Card>

      <Card
        title="Password"
        intro="The password used to sign in to this admin portal."
      >
        <ChangePassword />
      </Card>

      <Card
        title="Two-factor authentication"
        intro="Add a second factor — a time-based code from an authenticator app — to admin sign-in. Optional for signing in; dashboard actions on integrations need it."
      >
        <TwoFactor
          enabled={twoFactorEnabled}
          onChange={(enabled) => {
            onTwoFactorChange(enabled);
            setVersion((v) => v + 1);
          }}
        />
      </Card>

      <Card
        title="Sessions"
        intro="Where this portal is signed in. End a session you don't recognise, or sign out everywhere else after using a shared device."
      >
        <Sessions />
      </Card>

      <Card
        title="Recent activity"
        intro="Sign-ins and the changes that matter, with where they came from. Channels with Security on are told about a sign-in from a new address, a lockout, the second factor or password changing, and actions turned on."
      >
        <SecurityActivity version={version} />
      </Card>
    </>
  );
}
