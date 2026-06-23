"use client";

import { useState, type FormEvent } from "react";
import type { AppItem } from "@/lib/schema";
import Icon from "@/components/Icon";
import { TextField, Button, MoveButtons } from "./ui";
import IconField from "./IconField";
import { useReorder } from "./useReorder";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";

type FormState = {
  name: string;
  subtitle: string;
  url: string;
  icon: string;
  expectStatus: string;
};
const emptyForm: FormState = {
  name: "",
  subtitle: "",
  url: "",
  icon: "",
  expectStatus: "",
};

export default function AppsManager({ initialApps }: { initialApps: AppItem[] }) {
  const [apps, setApps] = useState(initialApps);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function startEdit(app: AppItem) {
    setEditingId(app.id);
    setForm({
      name: app.name,
      subtitle: app.subtitle,
      url: app.url,
      icon: app.icon,
      expectStatus: app.expectStatus ?? "",
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
      const res = await fetch(editingId ? `/api/apps/${editingId}` : "/api/apps", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to save"), "error");
        return;
      }
      const saved: AppItem = await res.json();
      const wasEditing = editingId;
      setApps((prev) =>
        wasEditing ? prev.map((a) => (a.id === wasEditing ? saved : a)) : [...prev, saved]
      );
      resetForm();
      toast(wasEditing ? "Application updated" : "Application added");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete this application?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/apps/${id}`, { method: "DELETE" });
    setApps((prev) => prev.filter((a) => a.id !== id));
    if (editingId === id) resetForm();
    toast("Application deleted");
  }

  async function persistOrder(next: AppItem[]) {
    const previous = apps;
    setApps(next); // optimistic
    const res = await fetch("/api/apps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((a) => a.id) }),
    });
    if (!res.ok) {
      setApps(previous);
      toast("Couldn't save the new order", "error");
    }
  }

  const { handlers, dragIndex, overIndex, move } = useReorder(apps, persistOrder);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_minmax(320px,380px)]">
      <div className="space-y-3">
        {apps.length === 0 && (
          <p className="text-sm text-fg/40">No applications yet. Add your first one.</p>
        )}
        {apps.map((app, index) => (
          <div
            key={app.id}
            {...handlers(index)}
            className={`flex items-center justify-between gap-4 rounded-xl border bg-fg/[0.03] px-4 py-3 transition-colors ${
              overIndex === index && dragIndex !== index
                ? "border-violet-400/60"
                : "border-fg/10"
            } ${dragIndex === index ? "opacity-50" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <MoveButtons index={index} count={apps.length} label={app.name} onMove={move} />
              <span
                className="hidden cursor-grab text-fg/30 select-none active:cursor-grabbing sm:inline"
                aria-hidden
                title="Drag to reorder"
              >
                ⠿
              </span>
              <Icon icon={app.icon} name={app.name} size={24} />
              <div className="min-w-0">
                <p className="truncate font-medium">{app.name}</p>
                <p className="truncate text-xs text-fg/40">
                  {app.subtitle ? `${app.subtitle} · ${app.url}` : app.url}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" type="button" onClick={() => startEdit(app)}>
                Edit
              </Button>
              <Button variant="danger" type="button" onClick={() => handleDelete(app.id)}>
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
        <h3 className="font-semibold">{editingId ? "Edit application" : "Add application"}</h3>
        <TextField
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextField
          label="Subtitle"
          value={form.subtitle}
          onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
        />
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
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg/50">Counts as up when</span>
          <div className="flex overflow-hidden rounded-lg border border-fg/10 text-xs">
            {(
              [
                { key: "any", label: "Any response", value: "" },
                { key: "ok", label: "2xx & 3xx", value: "200-399" },
                { key: "custom", label: "Custom", value: null },
              ] as const
            ).map((opt) => {
              const mode =
                form.expectStatus === ""
                  ? "any"
                  : form.expectStatus === "200-399"
                    ? "ok"
                    : "custom";
              const selected = mode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      expectStatus:
                        opt.value === null
                          ? form.expectStatus || "200-299"
                          : opt.value,
                    })
                  }
                  className={`flex-1 px-2 py-1.5 transition-colors ${
                    selected ? "bg-fg/15 text-fg" : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {form.expectStatus !== "" && form.expectStatus !== "200-399" && (
            <input
              value={form.expectStatus}
              onChange={(e) => setForm({ ...form, expectStatus: e.target.value })}
              placeholder="e.g. 200-299, 401"
              className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg outline-none transition-colors"
            />
          )}
          <p className="text-xs text-fg/40">
            Otherwise any reachable host counts as up (even 4xx/5xx). Use this to
            mark e.g. a 404 as down.
          </p>
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
