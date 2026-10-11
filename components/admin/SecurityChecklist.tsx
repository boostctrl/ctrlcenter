"use client";

import { useEffect, useState } from "react";
import { Hint } from "./ui";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";
import type { ChecklistLevel, ChecklistRow } from "@/lib/security-checklist";

// The security checklist card's body (#367): one row per fact, with a
// coloured dot for its state. Re-reads when `version` changes (the 2FA card
// beside it turns the factor on or off).

const DOT: Record<ChecklistLevel, string> = {
  ok: "bg-status-up",
  warn: "bg-status-warning",
  bad: "bg-status-down",
};
const LABEL: Record<ChecklistLevel, string> = {
  ok: "OK",
  warn: "Worth a look",
  bad: "Fix before exposing",
};

export default function SecurityChecklist({ version }: { version: number }) {
  const [rows, setRows] = useState<ChecklistRow[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/security");
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          toast(apiErrorMessage(data, "Couldn't load the checklist"), "error");
          return;
        }
        setRows(data.rows);
      } catch {
        if (!cancelled) toast("Couldn't load the checklist", "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, toast]);

  if (rows === null) return <Hint>Checking…</Hint>;
  const bad = rows.filter((r) => r.level === "bad").length;
  const warn = rows.filter((r) => r.level === "warn").length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-70">
        {bad === 0 && warn === 0
          ? "Nothing to fix."
          : [
              bad > 0 && `${bad} to fix before exposing the portal`,
              warn > 0 && `${warn} worth a look`,
            ]
              .filter(Boolean)
              .join(", ") + "."}
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[r.level]}`}
            />
            <div className="min-w-0">
              <span className="font-medium text-ink-90">{r.title}</span>
              <span className="sr-only">: {LABEL[r.level]}.</span>
              <p className="text-xs text-ink-50">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
