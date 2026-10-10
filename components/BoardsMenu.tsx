"use client";

// The layout editor's board menu (#303): switch to another board's editor;
// rename, reorder, set who can open, or delete this one (#318); or start a
// new board — without a trip to Settings → Layout. Saves the board list
// (PUT /api/boards; layouts aren't sent, so they're kept as stored).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { slugId } from "@/lib/slug";
import { saveBoards } from "./admin/settingsApi";
import { useConfirm } from "./admin/Confirm";
import { buttonClasses } from "@/lib/buttons";

export type EditorBoard = {
  id: string;
  name: string;
  visibility: "public" | "private";
  // A gallery pack pinned as the board's theme (#337).
  theme?: string;
};

const MAX_BOARDS = 20;
const MAX_NAME = 60;

const nameOf = (b: EditorBoard) => b.name.trim() || b.id;
// The first board is the home page.
const editorHref = (boards: EditorBoard[], id: string) =>
  boards[0]?.id === id ? "/?edit=1" : `/b/${encodeURIComponent(id)}?edit=1`;

export default function BoardsMenu({
  boards,
  currentId,
  packNames = [],
}: {
  boards: EditorBoard[];
  currentId: string;
  // The gallery's pack names, to pin one as this board's theme (#337).
  packNames?: string[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const index = boards.findIndex((b) => b.id === currentId);
  const current = boards[index];
  const [rename, setRename] = useState(current ? current.name : "");
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Where the popover sits on large screens: above its button. It renders in
  // a portal, clear of the editor bar (whose blur would otherwise contain it
  // and whose phone row scrolls sideways).
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A confirmation open over the menu closes first.
      if (e.key !== "Escape" || document.querySelector("[role='alertdialog']")) return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // A confirmation opened from the menu is part of it.
      if ((t as Element).closest?.("[role='alertdialog']")) return;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t))
        setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!current) return null;

  async function save(next: EditorBoard[], then?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await saveBoards(
        // The theme goes every time ("" for none), so clearing it sticks.
        next.map(({ id, name, visibility, theme }) => ({ id, name, visibility, theme: theme ?? "" })),
      );
      if (then) then();
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the boards");
    } finally {
      setBusy(false);
    }
  }

  function move(by: -1 | 1) {
    const to = index + by;
    const next = [...boards];
    [next[index], next[to]] = [next[to], next[index]];
    // Becoming (or leaving) the first board changes this board's address.
    save(next, () =>
      router.replace(editorHref(next, currentId), { scroll: false }),
    );
  }

  function setVisibility(visibility: EditorBoard["visibility"]) {
    save(boards.map((b) => (b.id === currentId ? { ...b, visibility } : b)));
  }

  // Pin a gallery theme on this board, or "" for the site's (#337).
  function setTheme(theme: string) {
    save(boards.map((b) => (b.id === currentId ? { ...b, theme: theme || undefined } : b)));
  }

  // Delete this board, then edit the home board. Its widgets stay: on other
  // boards, and in Settings → Widgets.
  async function remove() {
    const next = boards.filter((b) => b.id !== currentId);
    const ok = await confirm({
      title: `Delete the ${nameOf(current)} board?`,
      message:
        "Its arrangement goes; its widgets stay, on any other boards they're on and in Settings → Widgets." +
        (index === 0 ? ` ${nameOf(next[0])} becomes the home page.` : ""),
      confirmLabel: "Delete board",
      danger: true,
    });
    if (!ok) return;
    save(next, () => {
      setOpen(false);
      router.push(editorHref(next, next[0].id));
    });
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    const id = slugId(
      name,
      boards.map((b) => b.id),
      "board",
    );
    const next = [...boards, { id, name, visibility: "public" as const }];
    save(next, () => {
      setNewName("");
      setOpen(false);
      router.push(editorHref(next, id));
    });
  }

  const field =
    "min-w-0 flex-1 rounded-lg border border-fg/15 bg-fg/[0.03] px-2.5 py-1.5 text-sm text-ink-90 outline-none focus-visible:border-violet-400";
  const small =
    "shrink-0 rounded-lg border border-fg/10 px-2.5 py-1.5 text-xs text-ink-70 transition-colors hover:bg-fg/10 disabled:opacity-40";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ left: r.left, bottom: window.innerHeight - r.top + 12 });
          setRename(current.name);
          setError(null);
          setOpen((o) => !o);
        }}
        className="max-w-48 truncate rounded-full border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-ink-80 transition-colors hover:bg-fg/10"
      >
        Board: {nameOf(current)}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            data-boards-menu
            data-editor-keep
            role="dialog"
            aria-label="Boards"
            style={
              {
                "--pop-left": `${pos.left}px`,
                "--pop-bottom": `${pos.bottom}px`,
              } as React.CSSProperties
            }
            className="fixed inset-x-3 bottom-36 z-[50] flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-2xl border border-fg/10 bg-[var(--background)] p-3 text-sm shadow-2xl lg:inset-x-auto lg:bottom-[var(--pop-bottom)] lg:left-[var(--pop-left)] lg:w-80"
          >
            <nav aria-label="Edit another board">
              <ul className="flex flex-col gap-0.5">
                {boards.map((b, i) => (
                  <li key={b.id}>
                    <Link
                      href={editorHref(boards, b.id)}
                      aria-current={b.id === currentId ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-fg/5 ${
                        b.id === currentId
                          ? "bg-fg/5 font-medium text-ink-90"
                          : "text-ink-70"
                      }`}
                    >
                      <span className="truncate">{nameOf(b)}</span>
                      <span className="shrink-0 text-xs text-ink-55">
                        {i === 0
                          ? "Home"
                          : b.visibility === "private"
                            ? "Only me"
                            : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <form
              className="flex flex-col gap-1.5 border-t border-fg/10 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                save(
                  boards.map((b) =>
                    b.id === currentId ? { ...b, name: rename.trim() } : b,
                  ),
                );
              }}
            >
              <label
                htmlFor="editor-board-name"
                className="text-xs text-ink-60"
              >
                This board&apos;s name
              </label>
              <div className="flex gap-1.5">
                <input
                  id="editor-board-name"
                  value={rename}
                  maxLength={MAX_NAME}
                  onChange={(e) => setRename(e.target.value)}
                  className={field}
                />
                <button
                  type="submit"
                  disabled={busy || rename.trim() === current.name.trim()}
                  className={small}
                >
                  Rename
                </button>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => move(-1)}
                  className={small}
                >
                  Move earlier
                </button>
                <button
                  type="button"
                  disabled={busy || index === boards.length - 1}
                  onClick={() => move(1)}
                  className={small}
                >
                  Move later
                </button>
              </div>
            </form>
            <div className="flex flex-col gap-1.5 border-t border-fg/10 pt-3">
              <label
                htmlFor="editor-board-visibility"
                className="text-xs text-ink-60"
              >
                Who can open this board
              </label>
              <select
                id="editor-board-visibility"
                value={current.visibility}
                disabled={busy}
                onChange={(e) =>
                  setVisibility(e.target.value === "private" ? "private" : "public")
                }
                className={field}
              >
                <option value="public">Everyone</option>
                <option value="private">Only me</option>
              </select>
              {current.visibility === "private" && index === 0 && boards.length > 1 && (
                <p className="text-xs text-ink-55">
                  Visitors who aren&apos;t signed in get the first board open to
                  everyone instead.
                </p>
              )}
            </div>
            {packNames.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-fg/10 pt-3">
                <label htmlFor="editor-board-theme" className="text-xs text-ink-60">
                  This board&apos;s theme
                </label>
                <select
                  id="editor-board-theme"
                  value={current.theme && packNames.includes(current.theme) ? current.theme : ""}
                  disabled={busy}
                  onChange={(e) => setTheme(e.target.value)}
                  className={field}
                >
                  <option value="">The site theme</option>
                  {packNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-55">
                  A theme from the gallery, on this board only. Visitors&apos; own
                  choices still apply over it.
                </p>
              </div>
            )}
            {boards.length < MAX_BOARDS && (
              <form
                className="flex flex-col gap-1.5 border-t border-fg/10 pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <label
                  htmlFor="editor-new-board"
                  className="text-xs text-ink-60"
                >
                  New board
                </label>
                <div className="flex gap-1.5">
                  <input
                    id="editor-new-board"
                    value={newName}
                    maxLength={MAX_NAME}
                    placeholder="Media, Infra…"
                    onChange={(e) => setNewName(e.target.value)}
                    className={field}
                  />
                  <button
                    type="submit"
                    disabled={busy || !newName.trim()}
                    className={small}
                  >
                    Create
                  </button>
                </div>
              </form>
            )}
            {boards.length > 1 && (
              <div className="border-t border-fg/10 pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={remove}
                  className={buttonClasses("danger", "sm")}
                >
                  Delete this board
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-status-down">
                {error}
              </p>
            )}
            <p className="text-xs text-ink-55">
              All boards are also in{" "}
              <Link
                href="/admin?tab=settings&section=layout"
                className="underline hover:text-ink-80"
              >
                Settings → Layout
              </Link>
              .
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
