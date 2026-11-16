"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Button, Hint, ListPanel, TextField, subCardClasses } from "./ui";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";
import { fetchWithReauth } from "./reauth";
import { relativeTime } from "@/components/StatusTimeline";

// An account's passkeys (#537), on its own page: each with where it works
// and when it was last used, a way to add one through the browser's own
// prompt, and to remove one. Adding and removing ask for the password
// again.
type Item = { id: string; name: string; rpId: string; createdAt: number; lastUsedAt: number | null };

export default function Passkeys() {
  const [data, setData] = useState<{ host: string; passkeys: Item[] } | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/passkeys").catch(() => null);
    if (res?.ok) setData(await res.json());
    setNow(Date.now());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read after mount, and what the browser can do
    setSupported(browserSupportsWebAuthn());
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const opts = await fetchWithReauth("/api/passkeys/options", { method: "POST" });
      if (!opts.ok) {
        toast(apiErrorMessage(await opts.json().catch(() => null), "Couldn't start adding a passkey"), "error");
        return;
      }
      let response;
      try {
        response = await startRegistration({ optionsJSON: await opts.json() });
      } catch (err) {
        // Cancelled at the browser's prompt: nothing to say.
        if ((err as Error).name !== "NotAllowedError") toast("The browser couldn't make a passkey", "error");
        return;
      }
      const res = await fetchWithReauth("/api/passkeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, name }),
      });
      if (!res.ok) {
        toast(apiErrorMessage(await res.json().catch(() => null), "Couldn't add the passkey"), "error");
        return;
      }
      setName("");
      toast("Passkey added");
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: Item) {
    const ok = await confirm({
      title: `Remove ${p.name}?`,
      message: "It won't sign you in here any more. Remove it from your device or password manager too.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    const res = await fetchWithReauth(`/api/passkeys/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (!res.ok) toast("Couldn't remove the passkey", "error");
    await load();
  }

  if (!data) return <Hint>Loading…</Hint>;
  return (
    <div className="flex flex-col gap-3">
      {data.passkeys.length === 0 ? (
        <Hint>No passkeys yet.</Hint>
      ) : (
        <ListPanel>
          {data.passkeys.map((p) => (
            <div key={p.id} className={`${subCardClasses} flex flex-wrap items-center justify-between gap-2 p-3`}>
              <div className="min-w-0">
                <p className="font-medium text-ink-90">{p.name}</p>
                <p className="text-xs text-ink-45">
                  {p.rpId === data.host ? "Works here" : `Works at ${p.rpId}`}
                  {` · ${p.lastUsedAt ? `Last used ${relativeTime(p.lastUsedAt, now)}` : "Never used"}`}
                </p>
              </div>
              <Button type="button" size="sm" variant="danger" onClick={() => void remove(p)}>
                Remove
              </Button>
            </div>
          ))}
        </ListPanel>
      )}
      {supported === false ? (
        <Hint>This browser can&apos;t make passkeys.</Hint>
      ) : (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <TextField label="Name it" placeholder="Phone" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={busy || supported !== true}>
            Add a passkey
          </Button>
        </form>
      )}
    </div>
  );
}
