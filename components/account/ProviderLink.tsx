"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/Toast";
import { useConfirm } from "@/components/admin/Confirm";
import { apiErrorMessage } from "@/components/admin/apiError";
import { fetchWithReauth } from "@/components/admin/reauth";
import { oidcFailureMessage } from "@/lib/oidc-messages";

// Connecting an account to the sign-in provider (#555), on its own page: a
// provider sign-in reaches only the account connected to that provider
// account, so each account connects once, here, after confirming it's
// itself. Disconnecting asks again.
export default function ProviderLink({
  label,
  connected,
}: {
  label: string;
  connected: { name: string; linkedAt: number } | null;
}) {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const error = params.get("providerError");

  async function connect() {
    setBusy(true);
    try {
      const res = await fetchWithReauth("/api/provider-link", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !body?.url) {
        toast(apiErrorMessage(body, "Couldn't start connecting"), "error");
        return;
      }
      window.location.assign(body.url);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    const ok = await confirm({
      title: `Disconnect ${label}?`,
      message: `Signing in with ${label} stops reaching this account until you connect it again.`,
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    const res = await fetchWithReauth("/api/provider-link", { method: "DELETE" });
    if (!res.ok) {
      toast("Couldn't disconnect", "error");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-status-down">
          {oidcFailureMessage(error)}
        </p>
      )}
      {params.get("provider") === "connected" && connected && (
        <p role="status" className="text-sm text-status-up">
          Connected. You can sign in with {label} now.
        </p>
      )}
      {connected ? (
        <p className="text-sm text-ink-70">
          Connected to {label}
          {connected.name ? (
            <>
              {" "}
              as <strong className="text-ink-90">{connected.name}</strong>
            </>
          ) : null}
          , since {new Date(connected.linkedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}.
        </p>
      ) : (
        <p className="text-sm text-ink-70">
          Not connected. Connect your {label} account to sign in with it; you&apos;ll confirm it&apos;s you, then sign in
          there.
        </p>
      )}
      <div>
        {connected ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void disconnect()} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void connect()} disabled={busy}>
            Connect {label}
          </Button>
        )}
      </div>
    </div>
  );
}
