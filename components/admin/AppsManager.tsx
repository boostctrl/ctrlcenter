"use client";

import { useState, type FormEvent } from "react";
import type { AppItem } from "@/lib/schema";
import { CHECK_TYPES, type CheckType } from "@/lib/status";
import Icon from "@/components/Icon";
import {
  TextField,
  Button,
  MoveButtons,
  DragGrip,
  PrivateChip,
  PrivateToggle,
} from "./ui";
import IconField from "./IconField";
import { useReorder, dropIndicatorClass } from "./useReorder";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { apiErrorMessage } from "./apiError";

type FormState = {
  name: string;
  subtitle: string;
  url: string;
  icon: string;
  private: boolean;
  expectStatus: string;
  checkType: CheckType;
  port: string;
  keyword: string;
};
const emptyForm: FormState = {
  name: "",
  subtitle: "",
  url: "",
  icon: "",
  private: false,
  expectStatus: "",
  checkType: "http",
  port: "",
  keyword: "",
};

// One-line description of what each check method does, shown under the picker.
function checkTypeHint(t: CheckType): string {
  switch (t) {
    case "tcp":
      return "Up when a TCP connection to the host & port opens.";
    case "keyword":
      return "Fetches the page; up only if the text below appears in the response.";
    case "dns":
      return "Sends a DNS query to the URL's host — up when it answers. For DNS servers like Pi-hole.";
    case "icmp":
      return "Pings the URL's host. Needs ICMP (NET_RAW) in containers.";
    case "http":
    default:
      return "Sends an HTTP request to the URL and checks the response code.";
  }
}

// The "up when" mode tracked explicitly (rather than derived from the value, so
// "Custom" can be selected even when the value happens to equal a preset).
type UpMode = "any" | "ok" | "custom";
function modeFromExpect(v: string): UpMode {
  const t = v.trim();
  if (t === "") return "any";
  if (t === "200-399") return "ok";
  return "custom";
}

export default function AppsManager({ initialApps }: { initialApps: AppItem[] }) {
  const [apps, setApps] = useState(initialApps);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [upMode, setUpMode] = useState<UpMode>("any");
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
      private: app.private,
      expectStatus: app.expectStatus ?? "",
      checkType: app.checkType ?? "http",
      port: app.port != null ? String(app.port) : "",
      keyword: app.keyword ?? "",
    });
    setUpMode(modeFromExpect(app.expectStatus ?? ""));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setUpMode("any");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Only send the fields relevant to the chosen check method; clear the
      // others (so switching method doesn't leave a stale keyword/expectStatus
      // applying). `port` is sent as a number only when a TCP/DNS port was
      // entered.
      const payload = {
        name: form.name,
        subtitle: form.subtitle,
        url: form.url,
        icon: form.icon,
        private: form.private,
        checkType: form.checkType,
        expectStatus: form.checkType === "http" ? form.expectStatus : "",
        keyword: form.checkType === "keyword" ? form.keyword : "",
        ...((form.checkType === "tcp" || form.checkType === "dns") &&
        form.port.trim()
          ? { port: Number(form.port) }
          : {}),
      };
      const res = await fetch(editingId ? `/api/apps/${editingId}` : "/api/apps", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    try {
      const res = await fetch(`/api/apps/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Failed to delete"), "error");
        return;
      }
    } catch {
      toast("Failed to delete", "error");
      return;
    }
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

  const { handlers, grip, dragIndex, overIndex, dropEdge, move } = useReorder(
    apps,
    persistOrder
  );

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
            className={`flex items-center justify-between gap-4 rounded-xl border border-fg/10 bg-fg/[0.03] px-4 py-3 transition-colors ${dropIndicatorClass(
              index,
              { dragIndex, overIndex, dropEdge }
            )} ${dragIndex === index ? "opacity-50" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <MoveButtons index={index} count={apps.length} label={app.name} onMove={move} />
              <DragGrip {...grip(index)} />
              <Icon icon={app.icon} name={app.name} size={24} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {/* min-w-0: a flex item won't shrink below its content, so
                      truncate can't clip without it */}
                  <span className="min-w-0 truncate">{app.name}</span>
                  {app.private && <PrivateChip />}
                </p>
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
        className="glass-card flex h-fit flex-col gap-4 p-5"
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
        <PrivateToggle
          checked={form.private}
          onChange={(v) => setForm({ ...form, private: v })}
          hint="Hides this app from signed-out visitors everywhere, including the status page. It's still monitored and alerted on."
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="check-method" className="text-sm text-fg/50">
            Check method
          </label>
          <select
            id="check-method"
            value={form.checkType}
            onChange={(e) =>
              setForm({ ...form, checkType: e.target.value as CheckType })
            }
            className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg outline-none transition-colors"
          >
            {CHECK_TYPES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-fg/40">{checkTypeHint(form.checkType)}</p>
        </div>

        {(form.checkType === "tcp" || form.checkType === "dns") && (
          <TextField
            label="Port"
            type="number"
            min={1}
            max={65535}
            placeholder={
              form.checkType === "dns"
                ? "53"
                : "Defaults to the URL's port (or 443/80)"
            }
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
          />
        )}

        {form.checkType === "keyword" && (
          <TextField
            label="Keyword in response"
            placeholder="e.g. Welcome"
            value={form.keyword}
            onChange={(e) => setForm({ ...form, keyword: e.target.value })}
          />
        )}

        {form.checkType === "http" && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg/50">Counts as up when</span>
          <div className="flex overflow-hidden rounded-lg border border-fg/10 text-xs">
            {(
              [
                { key: "any", label: "Any response" },
                { key: "ok", label: "2xx & 3xx" },
                { key: "custom", label: "Custom" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={upMode === opt.key}
                onClick={() => {
                  setUpMode(opt.key);
                  if (opt.key === "any") setForm({ ...form, expectStatus: "" });
                  else if (opt.key === "ok")
                    setForm({ ...form, expectStatus: "200-399" });
                  else
                    setForm({
                      ...form,
                      expectStatus:
                        modeFromExpect(form.expectStatus) === "custom"
                          ? form.expectStatus
                          : "200-299",
                    });
                }}
                className={`flex-1 px-2 py-1.5 transition-colors ${
                  upMode === opt.key
                    ? "bg-fg/15 text-fg"
                    : "text-fg/50 hover:text-fg/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {upMode === "custom" && (
            <input
              value={form.expectStatus}
              onChange={(e) => setForm({ ...form, expectStatus: e.target.value })}
              placeholder="e.g. 200-299, 401"
              className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg outline-none transition-colors"
            />
          )}
          <p className="text-xs text-fg/40">
            {upMode === "any"
              ? "Any reachable host counts as up — even a 4xx/5xx response."
              : upMode === "ok"
                ? "Up only on a 2xx or 3xx response."
                : "Up only when the response code is in these codes/ranges — e.g. mark a 404 as down."}
          </p>
        </div>
        )}
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
