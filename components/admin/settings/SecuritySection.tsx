"use client";

import { Card } from "../ui";
import ChangePassword from "../ChangePassword";
import TwoFactor from "../TwoFactor";

export default function SecuritySection({
  initialTwoFactorEnabled,
}: {
  initialTwoFactorEnabled: boolean;
}) {
  return (
    <>
      <Card
        title="Password"
        intro="The password used to sign in to this admin portal."
      >
        <ChangePassword />
      </Card>

      <Card
        title="Two-factor authentication"
        intro="Add a second factor — a time-based code from an authenticator app — to admin sign-in. Strictly optional; leave it off to keep signing in with just your password."
      >
        <TwoFactor initialEnabled={initialTwoFactorEnabled} />
      </Card>
    </>
  );
}
