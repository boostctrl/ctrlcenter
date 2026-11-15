"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Hint } from "./ui";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";
import { fetchWithReauth } from "./reauth";

// The stored credentials at rest (#370), in Settings → Security: where the
// key comes from, how many are encrypted, still plaintext or unreadable, and
// the two things to do about it — encrypt the plaintext ones now, or replace
// the key file with a new one. `onChange` lets the checklist re-read.
type Status = { source: "env" | "file" | "none"; encrypted: number; plaintext: number; unreadable: number };

const count = (n: number) => `${n} credential${n === 1 ? "" : "s"}`;

export default function StoredCredentials({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/security/credentials").catch(() => null);
    if (res?.ok) setStatus((await res.json()) as Status);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read after mount
    void load();
  }, [load]);

  async function run(action: "encrypt" | "rotate") {
    if (action === "rotate") {
      const ok = await confirm({
        title: "Replace the encryption key?",
        message:
          "A new key replaces config.key, and every stored credential is saved again under it. Back up config.key with config.yaml afterwards: an older backup of one won't open the other.",
        confirmLabel: "Replace key",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const send = action === "rotate" ? fetchWithReauth : fetch;
      const res = await send("/api/security/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        toast(apiErrorMessage(await res.json().catch(() => null), "Couldn't update the stored credentials"), "error");
        return;
      }
      setStatus((await res.json()) as Status);
      toast(action === "rotate" ? "Key replaced; every credential is saved under the new one" : "Stored credentials encrypted");
      onChange();
    } catch {
      toast("Couldn't update the stored credentials", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <Hint>Loading…</Hint>;
  const total = status.encrypted + status.plaintext + status.unreadable;
  const where =
    status.source === "env"
      ? "Encrypted with the key in CONFIG_KEY."
      : status.source === "file"
        ? "Encrypted with a key kept in config.key, beside config.yaml. Back the two up together: config.yaml can't be read without it."
        : "Kept in plaintext: the config volume can't hold an encryption key. Set CONFIG_KEY, or make the volume writable.";
  const counts = [
    status.encrypted ? `${count(status.encrypted)} encrypted` : "",
    status.plaintext ? `${count(status.plaintext)} still in plaintext, encrypted at the next save` : "",
    status.unreadable ? `${count(status.unreadable)} that can't be opened with this key` : "",
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-70">{where}</p>
      <p className="text-xs text-ink-45">{total === 0 ? "No credentials are stored yet." : `${counts.join(" · ")}.`}</p>
      {status.unreadable > 0 && (
        <p className="text-xs text-status-down">
          Those don&apos;t work until the key they were saved with is back (as config.key, or as CONFIG_KEY_PREVIOUS), or
          they&apos;re entered again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {status.plaintext > 0 && status.source !== "none" && (
          <Button type="button" size="sm" onClick={() => run("encrypt")} disabled={busy}>
            Encrypt now
          </Button>
        )}
        {status.source === "file" && (
          <Button type="button" size="sm" variant="ghost" onClick={() => run("rotate")} disabled={busy || status.unreadable > 0}>
            Replace key
          </Button>
        )}
      </div>
      {status.source === "env" && (
        <Hint>
          To change it, set a new CONFIG_KEY, move the old one to CONFIG_KEY_PREVIOUS and restart; the next save moves
          every credential to the new key.
        </Hint>
      )}
    </div>
  );
}
