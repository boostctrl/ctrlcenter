import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readPublicConfig } from "@/lib/api-auth";
import { navPages } from "@/lib/nav";
import PageNav from "@/components/PageNav";
import FloatingNav from "@/components/FloatingNav";
import AccountPanels from "@/components/account/AccountPanels";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

// Every signed-in account's own page (#423): the password, the second
// factor and the sessions of the account that is signed in, member or
// admin. A visitor is sent to sign in and comes back here.
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ config, viewer }, query] = await Promise.all([readPublicConfig(), searchParams]);
  if (!viewer) redirect("/login?next=/account");
  const { account } = viewer;
  const nav = navPages(config, viewer);
  return (
    <>
      <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
        <div>
          <PageNav current={null} {...nav} />
          <h1 className="mt-3 text-3xl font-bold">Your account</h1>
          <p className="mt-1 text-sm text-ink-60">
            Signed in as <strong className="text-ink-90">{account.name || account.id}</strong>
            {account.name ? <span className="font-mono text-ink-45"> ({account.id})</span> : null}, {account.role === "admin" ? "an admin" : "a member"}.
          </p>
        </div>
        <AccountPanels twoFactorEnabled={account.totp.enabled} mustChangePassword={query.change === "1" || account.mustChangePassword} />
      </main>
      {config.settings.settingsButton && <FloatingNav {...nav} />}
    </>
  );
}
