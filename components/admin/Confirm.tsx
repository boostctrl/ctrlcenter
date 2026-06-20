"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./ui";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false)
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

// Styled in-app replacement for window.confirm(): `await confirm({ title })`
// resolves true/false. A single dialog host is rendered by the provider.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    []
  );

  const settle = useCallback(
    (ok: boolean) => {
      setPending((p) => {
        p?.resolve(ok);
        return null;
      });
    },
    []
  );

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") settle(false);
      if (e.key === "Enter") settle(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-label={pending.title}
            className="glass-card w-full max-w-sm space-y-4 p-5"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold">{pending.title}</h3>
            {pending.message && (
              <p className="text-sm text-fg/60">{pending.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button
                variant={pending.danger ? "danger" : "primary"}
                type="button"
                autoFocus
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
