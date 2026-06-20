"use client";

import { useState, type FormEvent } from "react";
import type { BookmarkItem } from "@/lib/schema";
import Icon from "@/components/Icon";
import { TextField, Button, MoveButtons } from "./ui";
import { useReorder } from "./useReorder";
import { useToast } from "./Toast";
import { apiErrorMessage } from "./apiError";

type FormState = { name: string; category: string; url: string; icon: string };
const emptyForm: FormState = { name: "", category: "", url: "", icon: "" };

export default function BookmarksManager({
  initialBookmarks,
}: {
  initialBookmarks: BookmarkItem[];
}) {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

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
    if (!confirm("Delete this bookmark?")) return;
    await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
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

  const { handlers, dragIndex, overIndex, move } = useReorder(bookmarks, persistOrder);

  const categories = Array.from(new Set(bookmarks.map((b) => b.category))).sort();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {bookmarks.length === 0 && (
          <p className="text-sm text-white/40">No bookmarks yet. Add your first one.</p>
        )}
        {bookmarks.map((bookmark, index) => (
          <div
            key={bookmark.id}
            {...handlers(index)}
            className={`flex items-center justify-between gap-4 rounded-xl border bg-white/[0.03] px-4 py-3 transition-colors ${
              overIndex === index && dragIndex !== index
                ? "border-violet-400/60"
                : "border-white/10"
            } ${dragIndex === index ? "opacity-50" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <MoveButtons
                index={index}
                count={bookmarks.length}
                label={bookmark.name}
                onMove={move}
              />
              <span
                className="hidden cursor-grab text-white/30 select-none active:cursor-grabbing sm:inline"
                aria-hidden
                title="Drag to reorder"
              >
                ⠿
              </span>
              <Icon icon={bookmark.icon} name={bookmark.name} size={24} />
              <div className="min-w-0">
                <p className="truncate font-medium">{bookmark.name}</p>
                <p className="truncate text-xs text-white/40">
                  {bookmark.category} &middot; {bookmark.url}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" type="button" onClick={() => startEdit(bookmark)}>
                Edit
              </Button>
              <Button variant="danger" type="button" onClick={() => handleDelete(bookmark.id)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="glass-card sticky top-6 flex h-fit flex-col gap-4 p-5"
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
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <TextField
              label="Icon (slug or image URL)"
              placeholder="e.g. amazon"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
            />
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
            <Icon icon={form.icon} name={form.name || "?"} size={22} />
          </div>
        </div>
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
