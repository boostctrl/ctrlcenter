"use client";

import { useState, useSyncExternalStore } from "react";
import { Button, controlClasses, fieldLabelClasses } from "./ui";

// The visitor's origin without a set-state-in-effect: "" on the server and first
// paint (hydration-safe), the real origin once mounted — so a built URL is
// exact for wherever the admin is browsing without guessing the host server-side.
const subscribeNever = () => () => {};
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => ""
  );
}

// A read-only URL the admin pastes somewhere else, with a Copy button: the
// inbound webhooks' URLs (#204), an app's push URL (#294).
export function CopyUrlField({
  label,
  ariaLabel,
  url,
}: {
  label: string;
  ariaLabel: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — the field is
      // selectable, so the admin can still copy by hand.
    }
  };
  return (
    <>
      <span className={fieldLabelClasses}>{label}</span>
      <div className="flex items-center gap-2">
        <input
          readOnly
          aria-label={ariaLabel}
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${controlClasses} min-w-0 flex-1 font-mono text-xs`}
        />
        <Button variant="ghost" size="sm" type="button" onClick={copy} disabled={!url}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </>
  );
}
