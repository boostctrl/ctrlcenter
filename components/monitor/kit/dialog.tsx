// A Monitor dialog (#518): a card over a dimmed page, kept to the keyboard
// the way the app's confirm dialog is. Focus moves into it when it opens (to
// `initialFocus`, or the card itself), Tab stays inside, Escape or a click
// on the dimmed page closes it, and focus goes back to what opened it. The
// card sits on an opaque base, since a glass card takes its color from what
// is behind it and over the dark scrim its light-mode text was unreadable
// (#269).
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/components/admin/useFocusTrap";

export function Dialog({
  title,
  description,
  onClose,
  alert = false,
  wide = false,
  initialFocus,
  actions,
  children,
}: {
  title: string;
  // The sentence under the title, read out with it.
  description?: ReactNode;
  onClose: () => void;
  // A dialog that asks before doing something that can't be undone.
  alert?: boolean;
  // A tall, wide card, for a log.
  wide?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  // Beside the title: a Close button, say.
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const titleId = useId();
  const descriptionId = useId();
  // The latest onClose, so a parent's re-render (a log arriving) doesn't
  // re-run the effect and pull focus back to the start.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    // A task later, so the keystroke that opened the dialog is over before
    // focus lands on one of its buttons (#146).
    const seed = setTimeout(() => (initialFocus?.current ?? trapRef.current)?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(seed);
      document.removeEventListener("keydown", onKey);
    };
  }, [initialFocus, trapRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={() => close.current()}
    >
      <div className={`w-full rounded-[var(--surface-radius)] bg-background ${wide ? "max-w-3xl" : "max-w-sm"}`}>
        <div
          ref={trapRef}
          role={alert ? "alertdialog" : "dialog"}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={`glass-card p-5 outline-none hover:transform-none ${wide ? "flex h-[70vh] flex-col gap-3" : "space-y-4"}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={titleId} className="truncate font-semibold" title={title}>
              {title}
            </h2>
            {actions}
          </div>
          {description && (
            <p id={descriptionId} className="text-sm break-words text-ink-60">
              {description}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
