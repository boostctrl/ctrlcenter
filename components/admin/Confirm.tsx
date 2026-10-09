"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

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
    //
    // A destructive dialog seeds focus on Cancel and leaves Enter to the focused
    // button, so a reflexive Enter backs out instead of deleting (#269); the
    // destructive action takes a deliberate Tab or click.
    const danger = Boolean(pending.danger);
    let ready = false;
    const arm = setTimeout(() => {
      ready = true;
      (danger ? cancelRef : acceptRef).current?.focus();
    }, 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") settle(false);
      else if (e.key === "Enter" && ready && !danger) settle(true);
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onMouseDown={() => settle(false)}
        >
          {/* Opaque base under the translucent card: the glass surface alone
              takes its color from whatever is behind it, which over the dark
              scrim made light-mode text unreadable (#269). */}
          <div className="w-full max-w-sm rounded-[var(--surface-radius)] bg-background">
            <div
              ref={trapRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={pending.message ? messageId : undefined}
              className="glass-card space-y-4 p-5 hover:transform-none"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2 id={titleId} className="font-semibold">
                {pending.title}
              </h2>
              {pending.message && (
                <p id={messageId} className="text-sm text-ink-75">
                  {pending.message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  ref={cancelRef}
                  variant="ghost"
                  type="button"
                  onClick={() => settle(false)}
                >
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
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
