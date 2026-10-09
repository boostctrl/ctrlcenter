"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastType = "success" | "error";
// An optional inline action, e.g. Undo after a delete (#307).
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; message: string; type: ToastType; action?: ToastAction };
type PushToast = (message: string, type?: ToastType, action?: ToastAction) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

let nextId = 1;
const DURATION_MS = 3500;
// Long enough to notice and reach an action button.
const ACTION_DURATION_MS = 8000;

// Minimal toast system: a provider holds the queue and renders a stacked
// bottom-right list; `useToast()` returns a `push(message, type)` function.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback(
    (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    []
  );

  const push = useCallback<PushToast>(
    (message, type = "success", action) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      setTimeout(() => dismiss(id), action ? ACTION_DURATION_MS : DURATION_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-xl ${
              t.type === "error"
                ? "border-red-500/40 bg-red-600/90"
                : "border-emerald-500/40 bg-emerald-700/95"
            }`}
          >
            <span className="flex items-center gap-3">
              {t.message}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(t.id);
                    t.action?.onClick();
                  }}
                  className="rounded-md border border-white/40 px-2 py-0.5 text-xs font-semibold hover:bg-white/15"
                >
                  {t.action.label}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
