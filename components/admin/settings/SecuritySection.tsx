"use client";

import { Card } from "../ui";
import ChangePassword from "../ChangePassword";
import TwoFactor from "../TwoFactor";
import Sessions from "../Sessions";

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

      <Card
        title="Sessions"
        intro="Where this portal is signed in. End a session you don't recognise, or sign out everywhere else after using a shared device."
      >
        <Sessions />
      </Card>
    </>
  );
}
