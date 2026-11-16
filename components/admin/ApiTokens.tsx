"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Hint, ListPanel, TextField, controlClasses, fieldLabelClasses, subCardClasses } from "./ui";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";
import { fetchWithReauth } from "./reauth";
import { CopyUrlField } from "./CopyUrlField";
import { relativeTime } from "@/components/StatusTimeline";

// Personal API tokens (#538): on the account page, the account's own, with
// a way to make one; in Settings → Users, every account's, for an admin to
// revoke (`all`). A new token is shown once, here, and never again.
type Token = {
  id: string;
  account: string;
  name: string;
  scope: "read" | "actions";
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
};

const EXPIRY = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "A year" },
  { days: null, label: "Never" },
] as const;

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export default function ApiTokens({ all = false, canAct = false }: { all?: boolean; canAct?: boolean }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "actions">("read");
  const [expiry, setExpiry] = useState<number | "never">(90);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch(`/api/tokens${all ? "?all=1" : ""}`).catch(() => null);
    if (res?.ok) setTokens(((await res.json()) as { tokens: Token[] }).tokens);
    setNow(Date.now());
  }, [all]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read after mount
    void load();
  }, [load]);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchWithReauth("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope, expiresInDays: expiry === "never" ? null : expiry }),
      });
      if (!res.ok) {
        toast(apiErrorMessage(await res.json().catch(() => null), "Couldn't make the token"), "error");
        return;
      }
      setMade(((await res.json()) as { token: string }).token);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function revoke(t: Token) {
    const ok = await confirm({
      title: `Revoke ${t.name}?`,
      message: "Anything using it stops working at once.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/tokens/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) toast("Couldn't revoke the token", "error");
    await load();
  }

  return (
    <div className="flex flex-col gap-3">
      {made && (
        <div className={`${subCardClasses} flex flex-col gap-2 p-3`} role="status">
          <CopyUrlField label="Your new token" ariaLabel="Copy the new token" url={made} />
          <p className="text-xs text-status-warning">Copy it now: it isn&apos;t shown again.</p>
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMade(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {tokens === null ? (
        <Hint>Loading…</Hint>
      ) : tokens.length === 0 ? (
        <Hint>{all ? "No account has a token." : "No tokens yet."}</Hint>
      ) : (
        <ListPanel>
          {tokens.map((t) => (
            <div key={t.id} className={`${subCardClasses} flex flex-wrap items-center justify-between gap-2 p-3`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink-90">{t.name}</span>
                  {all && <span className="font-mono text-xs text-ink-45">{t.account}</span>}
                  <span className="text-xs text-ink-60">{t.scope === "actions" ? "Read and act" : "Read"}</span>
                </p>
                <p className="text-xs text-ink-45">
                  {`Made ${day(t.createdAt)} · `}
                  {t.lastUsedAt ? `Last used ${relativeTime(t.lastUsedAt, now)}` : "Never used"}
                  {` · ${t.expiresAt ? (t.expiresAt <= now ? "Expired" : `Expires ${day(t.expiresAt)}`) : "Doesn't expire"}`}
                </p>
              </div>
              <Button type="button" size="sm" variant="danger" onClick={() => void revoke(t)}>
                Revoke
              </Button>
            </div>
          ))}
        </ListPanel>
      )}
      {!all && (
        <form onSubmit={make} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <TextField label="New token" placeholder="Home Assistant" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {canAct && (
            <label className="flex flex-col gap-1">
              <span className={fieldLabelClasses}>Can</span>
              <select
                className={controlClasses}
                value={scope}
                onChange={(e) => setScope(e.target.value === "actions" ? "actions" : "read")}
              >
                <option value="read">Read</option>
                <option value="actions">Read and act</option>
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={fieldLabelClasses}>Expires</span>
            <select
              className={controlClasses}
              value={String(expiry)}
              onChange={(e) => setExpiry(e.target.value === "never" ? "never" : Number(e.target.value))}
            >
              {EXPIRY.map((x) => (
                <option key={String(x.days)} value={x.days === null ? "never" : String(x.days)}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Make token
          </Button>
        </form>
      )}
    </div>
  );
}
