"use client";

import { useState } from "react";
import { Card } from "../ui";
import ChangePassword from "../ChangePassword";
import TwoFactor from "../TwoFactor";
import Sessions from "../Sessions";
import SecurityChecklist from "../SecurityChecklist";

export default function SecuritySection({
  initialTwoFactorEnabled,
}: {
  initialTwoFactorEnabled: boolean;
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
        <TwoFactor initialEnabled={initialTwoFactorEnabled} onChange={() => setVersion((v) => v + 1)} />
      </Card>

      <Card
        title="Sessions"
        intro="Where this portal is signed in. End a session you don't recognise, or sign out everywhere else after using a shared device."
      >
        <Sessions />
      </Card>
    </>
  );
}
