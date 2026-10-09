import { Suspense } from "react";
import { readConfigInternal } from "@/lib/config";
import { adminPasswordConfigured } from "@/lib/auth";
import BackHome from "@/components/BackHome";
import LoginForm from "./LoginForm";

// Rendered per request: whether a password exists depends on the runtime
// environment and config, not on anything known at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { auth } = await readConfigInternal();
  return (
    <main id="main-content" className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Suspense>
        <LoginForm passwordConfigured={adminPasswordConfigured(auth)} />
      </Suspense>
      <BackHome />
    </main>
  );
}
