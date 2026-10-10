"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEditMode } from "./EditMode";
import type { NavBoard } from "@/lib/nav";

// Board hotkeys (#298): 1–9 open the visitor's first nine boards, [ and ]
// step to the previous and next one (wrapping). Off while typing, while the
// layout editor is open, and with any modifier held, so they never fight a
// browser shortcut or the search box. Renders nothing.
export default function BoardKeys({ boards }: { boards: NavBoard[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const { editing } = useEditMode();

  useEffect(() => {
    if (editing || boards.length < 2) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      const here = Math.max(0, boards.findIndex((b) => b.href === pathname));
      let next: number | null = null;
      if (/^[1-9]$/.test(e.key)) next = Number(e.key) - 1;
      else if (e.key === "[") next = (here - 1 + boards.length) % boards.length;
      else if (e.key === "]") next = (here + 1) % boards.length;
      if (next === null || next >= boards.length || next === here) return;
      e.preventDefault();
      router.push(boards[next].href);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boards, editing, pathname, router]);

  return null;
}
