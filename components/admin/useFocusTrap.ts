"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keep Tab / Shift+Tab cycling inside an open dialog, and put focus back on
// the element that opened it when it closes. Overlays here are plain fixed
// divs, not <dialog>, so without this the tab order walks out into the page
// behind the backdrop, and closing would drop focus to <body> (#132). Attach
// the returned ref to the dialog's root; `active` follows the open state.
// Seeding focus on open stays with the dialog (an autoFocus on its natural
// first control), since only it knows which control that is.
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement;
    function onKey(e: KeyboardEvent) {
      const node = ref.current;
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || !node.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !node.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Focusing a detached node is a harmless no-op, so this is safe even
      // when the opener was removed while the dialog was up.
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [active]);
  return ref;
}
