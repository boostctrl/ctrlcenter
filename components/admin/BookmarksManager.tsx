"use client";

import { useRef, useState, type FormEvent } from "react";
import type { BookmarkItem } from "@/lib/schema";
import { orderCategories } from "@/lib/bookmarks";
import Icon from "@/components/Icon";
import { TextField, Button, MoveButtons, DragGrip } from "./ui";
import IconField from "./IconField";
import { useReorder, dropIndicatorClass } from "./useReorder";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";

type FormState = { name: string; category: string; url: string; icon: string };
const emptyForm: FormState = { name: "", category: "", url: "", icon: "" };

export default function BookmarksManager({
  initialBookmarks,
  initialCategoryOrder,
}: {
  initialBookmarks: BookmarkItem[];
  initialCategoryOrder: string[];
}) {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [categoryOrder, setCategoryOrder] = useState(initialCategoryOrder);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Which category heading is showing its inline rename field (null = none).
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  // Escape must cancel a rename, but blur fires right after it — this flag lets
  // the blur handler tell an Escape-driven unmount from a real commit.
  const cancelRename = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();

  function startEdit(bookmark: BookmarkItem) {
    setEditingId(bookmark.id);
    setForm({
      name: bookmark.name,
      category: bookmark.category,
      url: bookmark.url,
      icon: bookmark.icon,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(editingId ? `/api/bookmarks/${editingId}` : "/api/bookmarks", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to save"), "error");
        return;
      }
      const saved: BookmarkItem = await res.json();
      const wasEditing = editingId;
      setBookmarks((prev) =>
        wasEditing ? prev.map((b) => (b.id === wasEditing ? saved : b)) : [...prev, saved]
      );
      resetForm();
      toast(wasEditing ? "Bookmark updated" : "Bookmark added");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete this bookmark?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to delete"), "error");
        return;
      }
    } catch {
      toast("Failed to delete", "error");
      return;
    }
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    if (editingId === id) resetForm();
    toast("Bookmark deleted");
  }

  async function persistOrder(next: BookmarkItem[]) {
    const previous = bookmarks;
    setBookmarks(next); // optimistic
    const res = await fetch("/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((b) => b.id) }),
    });
    if (!res.ok) {
      setBookmarks(previous);
      toast("Couldn't save the new order", "error");
    }
  }

  // Commit a category's newly ordered items, rebuilding the flat list while
  // leaving other categories' positions untouched. Shared by drag-and-drop and
  // the up/down buttons (both go through a per-category `useReorder`).
  function commitGroup(category: string, reordered: BookmarkItem[]) {
    let gi = 0;
    persistOrder(
      bookmarks.map((b) => (b.category === category ? reordered[gi++] : b))
    );
  }

  async function persistCategoryOrder(next: string[]) {
    const previous = categoryOrder;
    setCategoryOrder(next); // optimistic
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarkCategoryOrder: next }),
    });
    if (!res.ok) {
      setCategoryOrder(previous);
      toast("Couldn't save the category order", "error");
    }
  }

  // Commit an inline category rename on Enter/blur. Escape (via cancelRename) or
  // an empty/unchanged field cancels, leaving everything untouched. Renaming onto
  // an existing category merges the two, gated behind a confirm. The server
  // rewrites every affected bookmark and the category order in one action.
  async function commitRename(from: string, value: string) {
    if (cancelRename.current) {
      cancelRename.current = false;
      setRenamingCategory(null);
      return;
    }
    const to = value.trim();
    if (!to || to === from) {
      setRenamingCategory(null);
      return;
    }
    if (present.includes(to)) {
      const ok = await confirm({
        title: `Merge “${from}” into “${to}”?`,
        message: `Every bookmark in “${from}” moves into “${to}”.`,
        confirmLabel: "Merge",
      });
      if (!ok) {
        setRenamingCategory(null);
        return;
      }
    }
    try {
      const res = await fetch("/api/bookmarks/category", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to rename"), "error");
        return;
      }
      const data: { bookmarks: BookmarkItem[]; bookmarkCategoryOrder: string[] } =
        await res.json();
      setBookmarks(data.bookmarks);
      setCategoryOrder(data.bookmarkCategoryOrder);
      toast("Category renamed");
    } catch {
      toast("Failed to rename", "error");
    } finally {
      // Only close OUR rename field: the fetch yielded, and the user may have
      // already opened a rename on another category in the meantime.
      setRenamingCategory((cur) => (cur === from ? null : cur));
    }
  }

  // First-seen categories, then ordered by the saved order.
  const present: string[] = [];
  const seenCat = new Set<string>();
  for (const b of bookmarks) {
    if (!seenCat.has(b.category)) {
      present.push(b.category);
      seenCat.add(b.category);
    }
  }
  const orderedCategories = orderCategories(present, categoryOrder);
  const groups: [string, BookmarkItem[]][] = orderedCategories.map((c) => [
    c,
    bookmarks.filter((b) => b.category === c),
  ]);
  const categories = [...present].sort();

  // Drag-and-drop for the category headings themselves. The per-category bookmark
  // rows use their own `useReorder` inside `CategoryGroup` (hooks can't run in a
  // loop). The heading is its own drop zone, so a row drag never bleeds into the
  // category order.
  const {
    handlers: catHandlers,
    grip: catGrip,
    dragIndex: catDragIndex,
    overIndex: catOverIndex,
    dropEdge: catDropEdge,
    move: moveCategory,
  } = useReorder(orderedCategories, persistCategoryOrder);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_minmax(320px,380px)]">
      <div className="space-y-6">
        {bookmarks.length === 0 && (
          <p className="text-sm text-fg/40">No bookmarks yet. Add your first one.</p>
        )}
        {groups.map(([category, items], catIndex) => (
          <div key={category} className="space-y-2">
            <div
              {...catHandlers(catIndex)}
              className={`flex items-center gap-2 transition-colors ${dropIndicatorClass(
                catIndex,
                {
                  dragIndex: catDragIndex,
                  overIndex: catOverIndex,
                  dropEdge: catDropEdge,
                }
              )} ${catDragIndex === catIndex ? "opacity-50" : ""}`}
            >
              <MoveButtons
                index={catIndex}
                count={groups.length}
                label={`category ${category}`}
                onMove={moveCategory}
              />
              <DragGrip {...catGrip(catIndex)} />
              {renamingCategory === category ? (
                <input
                  autoFocus
                  defaultValue={category}
                  aria-label={`Rename category ${category}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // Suppress the trailing keypress so, when this commit opens
                      // the merge confirm, that same Enter can't land on the
                      // dialog's autofocused button and accept it unprompted.
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      cancelRename.current = true;
                      setRenamingCategory(null);
                    }
                  }}
                  onBlur={(e) => commitRename(category, e.target.value)}
                  className="accent-focus min-w-0 rounded-md border border-fg/15 bg-fg/5 px-1.5 py-0.5 text-xs font-semibold tracking-[0.18em] text-fg uppercase outline-none"
                />
              ) : (
                <>
                  <h3 className="text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
                    {category}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      cancelRename.current = false;
                      setRenamingCategory(category);
                    }}
                    aria-label={`Rename category ${category}`}
                    className="shrink-0 rounded-md p-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-fg/80"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                </>
              )}
            </div>
            <CategoryGroup
              category={category}
              items={items}
              onReorder={commitGroup}
              onEdit={startEdit}
              onDelete={handleDelete}
            />
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="glass-card flex h-fit flex-col gap-4 p-5"
      >
        <h3 className="font-semibold">{editingId ? "Edit bookmark" : "Add bookmark"}</h3>
        <TextField
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextField
          label="Category"
          required
          list="bookmark-categories"
          placeholder="e.g. Shopping"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <datalist id="bookmark-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <TextField
          label="URL"
          required
          type="url"
          placeholder="https://"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
        />
        <IconField
          value={form.icon}
          onChange={(v) => setForm({ ...form, icon: v })}
          name={form.name}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {editingId ? "Save changes" : "Add"}
          </Button>
          {editingId && (
            <Button type="button" variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

// One category's bookmark rows, with drag-reorder scoped to this category (the
// edit form handles moving a bookmark to a different category). Extracted so it
// can own a `useReorder` — hooks can't be called per-iteration in the parent's
// group loop. `onReorder` hands the category's newly ordered items back to the
// parent, which rebuilds the flat bookmark list.
function CategoryGroup({
  category,
  items,
  onReorder,
  onEdit,
  onDelete,
}: {
  category: string;
  items: BookmarkItem[];
  onReorder: (category: string, next: BookmarkItem[]) => void;
  onEdit: (bookmark: BookmarkItem) => void;
  onDelete: (id: string) => void;
}) {
  const { handlers, grip, dragIndex, overIndex, dropEdge, move } = useReorder(
    items,
    (next) => onReorder(category, next)
  );

  return (
    <>
      {items.map((bookmark, index) => (
        <div
          key={bookmark.id}
          {...handlers(index)}
          className={`flex items-center justify-between gap-4 rounded-xl border border-fg/10 bg-fg/[0.03] px-4 py-3 transition-colors ${dropIndicatorClass(
            index,
            { dragIndex, overIndex, dropEdge }
          )} ${dragIndex === index ? "opacity-50" : ""}`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <MoveButtons
              index={index}
              count={items.length}
              label={bookmark.name}
              onMove={move}
            />
            <DragGrip {...grip(index)} />
            <Icon icon={bookmark.icon} name={bookmark.name} size={24} />
            <div className="min-w-0">
              <p className="truncate font-medium">{bookmark.name}</p>
              <p className="truncate text-xs text-fg/40">{bookmark.url}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" type="button" onClick={() => onEdit(bookmark)}>
              Edit
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={() => onDelete(bookmark.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      ))}
    </>
  );
}
