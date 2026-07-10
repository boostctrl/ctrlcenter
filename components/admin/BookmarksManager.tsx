"use client";

import { useState, type FormEvent } from "react";
import type { BookmarkItem } from "@/lib/schema";
import { orderCategories } from "@/lib/bookmarks";
import Icon from "@/components/Icon";
import { TextField, Button, MoveButtons } from "./ui";
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
              <span
                className="hidden cursor-grab text-fg/30 select-none active:cursor-grabbing sm:inline"
                aria-hidden
                title="Drag to reorder"
                {...catGrip(catIndex)}
              >
                ⠿
              </span>
              <h3 className="text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
                {category}
              </h3>
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
            <span
              className="hidden cursor-grab text-fg/30 select-none active:cursor-grabbing sm:inline"
              aria-hidden
              title="Drag to reorder"
              {...grip(index)}
            >
              ⠿
            </span>
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
