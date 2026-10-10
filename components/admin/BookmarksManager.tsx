"use client";

import { useState, type FormEvent } from "react";
import type { BookmarkItem, Group } from "@/lib/schema";
import { findGroupByName, groupBookmarks, groupName } from "@/lib/groups";
import Icon from "@/components/Icon";
import { RenameButton, RenameField } from "@/components/InlineRename";
import {
  Card,
  TextField,
  ToggleRow,
  Button,
  AddButton,
  MoveButtons,
  DragGrip,
  PrivateChip,
  subCardClasses,
} from "./ui";
import IconField from "./IconField";
import { useReorder, dropIndicatorClass } from "./useReorder";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { useRevealForm } from "./useRevealForm";
import { withHttpScheme } from "@/lib/urls";
import { apiErrorMessage } from "./apiError";
import type { GroupsState } from "./useGroups";

type FormState = {
  name: string;
  // The group's name (#299): an existing group, or a new one to create.
  groupName: string;
  url: string;
  icon: string;
  private: boolean;
};
const emptyForm: FormState = {
  name: "",
  groupName: "",
  url: "",
  icon: "",
  private: false,
};

export default function BookmarksManager({
  initialBookmarks,
  groupsState,
}: {
  initialBookmarks: BookmarkItem[];
  // The shared group list (#299): bookmarks are listed under their groups,
  // in its order.
  groupsState: GroupsState;
}) {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const { groups, refresh: refreshGroups, save: saveGroups } = groupsState;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Which group heading is showing its inline rename field, by id.
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { ref: formRef, reveal: revealForm } = useRevealForm<HTMLDivElement>();

  function startEdit(bookmark: BookmarkItem) {
    setEditingId(bookmark.id);
    setForm({
      name: bookmark.name,
      groupName: bookmark.group ? groupName(groups, bookmark.group) : "",
      url: bookmark.url,
      icon: bookmark.icon,
      private: bookmark.private,
    });
    revealForm();
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
        body: JSON.stringify({ ...form, url: withHttpScheme(form.url) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to save"), "error");
        return;
      }
      const saved: BookmarkItem = await res.json();
      // Naming a group that didn't exist created it server-side.
      if (!groups.some((g) => g.id === saved.group)) void refreshGroups();
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
    const index = bookmarks.findIndex((b) => b.id === id);
    const removed = index >= 0 ? bookmarks[index] : undefined;
    const name = removed?.name;
    const ok = await confirm({
      title: name ? `Delete “${name}”?` : "Delete this bookmark?",
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
    if (!removed) {
      toast("Bookmark deleted");
      return;
    }
    // Undo restores the same row (same id, so history and favorites still
    // match) at its old position (#307).
    toast(`Deleted “${removed.name}”`, "success", {
      label: "Undo",
      onClick: () => void undoDelete(removed, index),
    });
  }

  async function undoDelete(item: BookmarkItem, index: number) {
    try {
      const res = await fetch("/api/bookmarks/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, index }),
      });
      if (!res.ok) throw new Error();
      setBookmarks(await res.json());
      toast(`Restored “${item.name}”`);
    } catch {
      toast("Couldn't undo the delete", "error");
    }
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

  // Commit a group's newly ordered bookmarks, rebuilding the flat list while
  // leaving other groups' positions untouched. Shared by drag-and-drop and
  // the up/down buttons (both go through a per-group `useReorder`).
  function commitGroup(groupId: string, reordered: BookmarkItem[]) {
    let gi = 0;
    persistOrder(bookmarks.map((b) => (b.group === groupId ? reordered[gi++] : b)));
  }

  async function persistGroups(next: Group[], done: string) {
    try {
      const moved = await saveGroups(next);
      setBookmarks(moved.bookmarks);
      toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the groups", "error");
    }
  }

  // The group headings shown here are the groups with bookmarks; reordering
  // them moves them within the full list (apps' groups keep their places).
  async function persistGroupOrder(orderedIds: string[]) {
    const shown = new Set(orderedIds);
    let i = 0;
    const next = groups.map((g) => (shown.has(g.id) ? groups.find((x) => x.id === orderedIds[i++])! : g));
    await persistGroups(next, "Group order saved");
  }

  // Commit an inline group rename. An empty/unchanged field leaves everything
  // untouched. Renaming onto another group's name merges the two, gated
  // behind a confirm; the server moves every affected app and bookmark in one
  // write. RenameField suppresses the commit on an Escape cancel, so this only
  // runs on a real commit — and the confirm dialog ignores the Enter that
  // opened it (#146), so no local keystroke guard is needed here.
  async function commitRename(id: string, value: string) {
    const to = value.trim();
    const current = groups.find((g) => g.id === id);
    if (!current || !to || to === current.name) {
      setRenamingGroup(null);
      return;
    }
    const other = findGroupByName(groups, to);
    if (other && other.id !== id) {
      const ok = await confirm({
        title: `Merge “${current.name}” into “${other.name}”?`,
        message: `Every app and bookmark in “${current.name}” moves into “${other.name}”.`,
        confirmLabel: "Merge",
      });
      if (!ok) {
        setRenamingGroup(null);
        return;
      }
    }
    await persistGroups(
      groups.map((g) => (g.id === id ? { ...g, name: other && other.id !== id ? other.name : to } : g)),
      other && other.id !== id ? "Groups merged" : "Group renamed"
    );
    // Only close OUR rename field: the save yielded, and the user may have
    // already opened a rename on another group in the meantime.
    setRenamingGroup((cur) => (cur === id ? null : cur));
  }

  // Bookmarks under their groups, in the group list's order. A bookmark whose
  // group the list doesn't carry (a hand edit) shows under its id, or
  // "Other", and can't be renamed or reordered from here.
  const views = groupBookmarks(bookmarks, groups);
  const known = new Set(groups.map((g) => g.id));
  const orderedGroupIds = views.filter((v) => known.has(v.id)).map((v) => v.id);

  // Drag-and-drop for the group headings themselves. The per-group bookmark
  // rows use their own `useReorder` inside `GroupRows` (hooks can't run in a
  // loop). The heading is its own drop zone, so a row drag never bleeds into
  // the group order.
  const {
    handlers: catHandlers,
    grip: catGrip,
    dragIndex: catDragIndex,
    overIndex: catOverIndex,
    dropEdge: catDropEdge,
    move: moveGroup,
  } = useReorder(orderedGroupIds, persistGroupOrder);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
      <div className="space-y-6">
        {/* Keeps the heading outline h1 → h2 → h3 for screen readers (#274). */}
        <h2 className="sr-only">Your bookmarks</h2>
        {/* Phones stack the form below the list; this jumps to it (#272). */}
        <div className="lg:hidden">
          <AddButton
            onClick={() => {
              resetForm();
              revealForm();
            }}
          >
            + Add bookmark
          </AddButton>
        </div>
        {bookmarks.length === 0 && (
          <p className="text-sm text-ink-40">No bookmarks yet. Add your first one.</p>
        )}
        {views.map(({ id, name, items }) => {
          const catIndex = orderedGroupIds.indexOf(id);
          const movable = catIndex !== -1;
          return (
          <div key={id || "ungrouped"} className="space-y-2">
            {movable ? (
              <div
                {...catHandlers(catIndex)}
                className={`flex items-center gap-2 transition-colors ${dropIndicatorClass(catIndex, {
                  dragIndex: catDragIndex,
                  overIndex: catOverIndex,
                  dropEdge: catDropEdge,
                })} ${catDragIndex === catIndex ? "opacity-50" : ""}`}
              >
                <MoveButtons
                  index={catIndex}
                  count={orderedGroupIds.length}
                  label={`group ${name}`}
                  onMove={moveGroup}
                />
                <DragGrip {...catGrip(catIndex)} />
                {renamingGroup === id ? (
                  <RenameField
                    initialValue={name}
                    label={`Rename group ${name}`}
                    onCommit={(v) => commitRename(id, v)}
                    onCancel={() => setRenamingGroup(null)}
                    className="accent-focus min-w-0 rounded-md border border-fg/15 bg-fg/5 px-1.5 py-0.5 text-xs font-semibold tracking-[0.18em] text-fg uppercase outline-none"
                  />
                ) : (
                  <>
                    <h3 className="text-xs font-semibold tracking-[0.18em] text-ink-50 uppercase">
                      {name}
                    </h3>
                    <RenameButton
                      label={`Rename group ${name}`}
                      onClick={() => setRenamingGroup(id)}
                      className="shrink-0 rounded-md p-1 text-ink-40 transition-colors hover:bg-fg/10 hover:text-ink-80"
                    />
                  </>
                )}
              </div>
            ) : (
              <h3 className="text-xs font-semibold tracking-[0.18em] text-ink-50 uppercase">{name}</h3>
            )}
            <GroupRows
              groupId={id}
              items={items}
              onReorder={commitGroup}
              onEdit={startEdit}
              onDelete={handleDelete}
            />
          </div>
          );
        })}
      </div>

      <div ref={formRef} className="h-fit scroll-mt-6">
        <Card title={editingId ? "Edit bookmark" : "Add bookmark"}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="Group"
              required
              list="bookmark-groups"
              placeholder="e.g. Shopping"
              hint="An existing group, or a new name to start one."
              value={form.groupName}
              onChange={(e) => setForm({ ...form, groupName: e.target.value })}
            />
            <datalist id="bookmark-groups">
              {groups.map((g) => (
                <option key={g.id} value={g.name} />
              ))}
            </datalist>
            <TextField
              label="URL"
              required
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              // A bare host ("plex.local:32400") gets http:// (#277).
              onBlur={(e) => setForm({ ...form, url: withHttpScheme(e.target.value) })}
            />
            <IconField
              value={form.icon}
              onChange={(v) => setForm({ ...form, icon: v })}
              name={form.name}
            />
            <ToggleRow
              label="Only show when logged in"
              hint="Hides this bookmark from signed-out visitors. A group whose bookmarks are all private disappears with them."
              checked={form.private}
              onChange={(v) => setForm({ ...form, private: v })}
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
        </Card>
      </div>
    </div>
  );
}

// One group's bookmark rows, with drag-reorder scoped to this group (the edit
// form handles moving a bookmark to a different group). Extracted so it can
// own a `useReorder` — hooks can't be called per-iteration in the parent's
// group loop. `onReorder` hands the group's newly ordered items back to the
// parent, which rebuilds the flat bookmark list.
function GroupRows({
  groupId,
  items,
  onReorder,
  onEdit,
  onDelete,
}: {
  groupId: string;
  items: BookmarkItem[];
  onReorder: (groupId: string, next: BookmarkItem[]) => void;
  onEdit: (bookmark: BookmarkItem) => void;
  onDelete: (id: string) => void;
}) {
  const { handlers, grip, dragIndex, overIndex, dropEdge, move } = useReorder(
    items,
    (next) => onReorder(groupId, next)
  );

  return (
    <>
      {items.map((bookmark, index) => (
        <div
          key={bookmark.id}
          {...handlers(index)}
          className={`flex items-center justify-between gap-4 ${subCardClasses} px-4 py-3 transition-colors ${dropIndicatorClass(
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
              <p className="flex items-center gap-2 font-medium">
                {/* min-w-0: a flex item won't shrink below its content, so
                    truncate can't clip without it */}
                <span className="min-w-0 truncate">{bookmark.name}</span>
                {bookmark.private && <PrivateChip />}
              </p>
              <p className="truncate text-xs text-ink-40">{bookmark.url}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onEdit(bookmark)}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
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
