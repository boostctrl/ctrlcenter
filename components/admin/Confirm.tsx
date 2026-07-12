"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./ui";
import { useFocusTrap } from "./useFocusTrap";

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
  const trapRef = useFocusTrap<HTMLDivElement>(pending !== null);
  const acceptRef = useRef<HTMLButtonElement>(null);

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
    // Guard against the keystroke that OPENED the dialog also accepting it. When
    // a "press Enter → confirm" flow opens us, React can flush this effect
    // synchronously mid-keydown, so an Enter listener attached now still catches
    // that same Enter (bubbling up, or its trailing keyup) and self-approves —
    // and React's `autoFocus` would focus the confirm button right into the
    // keystroke's path too. So both accepting Enter and seeding focus wait a
    // task, by which point the opening keystroke is fully over (#146). Callers no
    // longer need a per-site preventDefault guard.
    let ready = false;
    const arm = setTimeout(() => {
      ready = true;
      acceptRef.current?.focus();
    }, 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") settle(false);
      else if (e.key === "Enter" && ready) settle(true);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(arm);
      document.removeEventListener("keydown", onKey);
    };
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
            ref={trapRef}
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
                ref={acceptRef}
                variant={pending.danger ? "danger" : "primary"}
                type="button"
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
