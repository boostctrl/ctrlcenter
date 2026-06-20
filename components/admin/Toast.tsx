"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastType = "success" | "error";
type Toast = { id: number; message: string; type: ToastType };
type PushToast = (message: string, type?: ToastType) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

let nextId = 1;
const DURATION_MS = 3500;

// Minimal toast system: a provider holds the queue and renders a stacked
// bottom-right list; `useToast()` returns a `push(message, type)` function.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback<PushToast>((message, type = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      DURATION_MS
    );
  }, []);

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
            className={`pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg backdrop-blur-xl ${
              t.type === "error"
                ? "border-red-500/30 bg-red-500/15 text-red-200"
                : "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
