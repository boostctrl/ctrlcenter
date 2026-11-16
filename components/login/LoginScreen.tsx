import { Suspense } from "react";
import { readConfigInternal } from "@/lib/config";
import { adminPasswordConfigured } from "@/lib/auth";
import { accountsOf } from "@/lib/accounts";
import BackHome from "@/components/BackHome";
import LoginForm from "./LoginForm";
import { oidcButtonLabel, oidcReady } from "@/lib/oidc";
import { forwardIdentity } from "@/lib/forward-auth";
import { headers } from "next/headers";

// The sign-in screen: at /login for everyone (#450) and at /admin/login,
// where the proxy sends a signed-out visit to an admin page. Rendered per
// request: whether a password exists depends on the runtime environment and
// config, not on anything known at build time. `fallback` is where a sign-in
// with no `next` lands: the portal from the admin address, the dashboard
// from the plain one.
export default async function LoginScreen({ fallback }: { fallback: string }) {
  const { auth, settings } = await readConfigInternal();
  // Signing in through a provider (#504), when it's set up.
  const o = settings.signIn.oidc;
  return (
    <main id="main-content" className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Suspense>
        <LoginForm
          passwordConfigured={adminPasswordConfigured(auth)}
          singleAccount={accountsOf(auth).length === 1}
          fallback={fallback}
          provider={oidcReady(o) ? oidcButtonLabel(o) : null}
          forwardUser={forwardIdentity(await headers(), settings.signIn.forwardAuth)?.raw ?? null}
        />
      </Suspense>
      <BackHome />
    </main>
  );
}
