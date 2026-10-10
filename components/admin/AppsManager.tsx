"use client";

import { useState, type FormEvent } from "react";
import type { AppItem, Group } from "@/lib/schema";
import { CHECK_TYPES, type CheckType } from "@/lib/status";
import Icon from "@/components/Icon";
import { ChipGroup } from "@/components/ChipGroup";
import {
  Card,
  TextField,
  SelectField,
  ToggleRow,
  Button,
  AddButton,
  MoveButtons,
  DragGrip,
  PrivateChip,
  UnmonitoredChip,
  Hint,
  fieldLabelClasses,
  controlClasses,
  subCardClasses,
} from "./ui";
import IconField from "./IconField";
import { useReorder, dropIndicatorClass } from "./useReorder";
import { useToast } from "./Toast";
import { useConfirm } from "./Confirm";
import { useRevealForm } from "./useRevealForm";
import { guessCheckType, withHttpScheme } from "@/lib/urls";
import { parseJsonQuery } from "@/lib/json-query";
import { CopyUrlField, useOrigin } from "./CopyUrlField";
import { apiErrorMessage } from "./apiError";
import { allTags, groupName } from "@/lib/groups";
import type { GroupsState } from "./useGroups";
import type { ItemsState } from "./useAdminData";

type FormState = {
  name: string;
  subtitle: string;
  // The group's name (#299): an existing group, a new one, or "" for none.
  groupName: string;
  // Comma-separated tags.
  tags: string;
  url: string;
  icon: string;
  private: boolean;
  expectStatus: string;
  checkType: CheckType;
  port: string;
  keyword: string;
  jsonQuery: string;
  // Days before a TLS certificate's expiry to warn (#294); "" = default/off.
  certWarnDays: string;
  // Whether the app gets status checks at all (#296).
  monitor: boolean;
  // Per-app check overrides (#292); "" = the global setting.
  interval: string;
  timeout: string;
  retries: string;
};
const emptyForm: FormState = {
  name: "",
  subtitle: "",
  groupName: "",
  tags: "",
  url: "",
  icon: "",
  private: false,
  expectStatus: "",
  checkType: "http",
  port: "",
  keyword: "",
  jsonQuery: "",
  certWarnDays: "",
  monitor: true,
  interval: "",
  timeout: "",
  retries: "",
};

// A push-checked app's secret URL (#294), once the app is saved (the server
// mints the token).
function PushUrl({ token }: { token: string }) {
  const origin = useOrigin();
  if (!token) {
    return <Hint>Save the app to get its push URL.</Hint>;
  }
  const url = origin ? `${origin}/api/push/${token}` : "";
  return (
    <div className="flex flex-col gap-2">
      <CopyUrlField label="Push URL" ariaLabel="Push URL" url={url} />
      <Hint>
        Have your job call it each time it runs — e.g. <code>curl -fsS &lt;url&gt;</code> at
        the end of a backup script — and set the interval under Advanced to how
        often it runs. Missing a run plus a minute counts as down.
      </Hint>
    </div>
  );
}

// The HTTP-family checks can watch an https site's certificate alongside
// (#294); the TLS check does nothing else.
const watchesCert = (t: CheckType) => t === "http" || t === "keyword" || t === "json";
const isHttps = (url: string) => /^https:\/\//i.test(withHttpScheme(url));

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
    case "json":
      return "Fetches the URL as JSON; up only if the query below holds.";
    case "push":
      return "Your job calls a secret URL each time it runs; up while those calls keep arriving.";
    case "tls":
      return "Reads the site's TLS certificate; warns before it expires and is down once it has.";
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

export default function AppsManager({
  items,
  groupsState,
  statusChecksEnabled,
  statusInterval,
}: {
  // The shared app list (#317) and group list (#299).
  items: ItemsState;
  groupsState: GroupsState;
  // From the server-rendered settings; toggling checks this session updates on
  // reload, like the nav flags.
  statusChecksEnabled: boolean;
  // The global check interval (minutes), shown as the per-app default.
  statusInterval: number;
}) {
  const { apps, setApps } = items;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [upMode, setUpMode] = useState<UpMode>("any");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Whether the check method was chosen by hand. Until it is, a new app's
  // method follows its URL (guessCheckType, #296).
  const [methodChosen, setMethodChosen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Apps ticked for a bulk group/tag change (#299).
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { groups, setGroups, refresh: refreshGroups } = groupsState;
  const toast = useToast();
  const confirm = useConfirm();
  const { ref: formRef, reveal: revealForm } = useRevealForm<HTMLDivElement>();

  function startEdit(app: AppItem) {
    setEditingId(app.id);
    setMethodChosen(true);
    setForm({
      name: app.name,
      subtitle: app.subtitle,
      groupName: app.group ? groupName(groups, app.group) : "",
      tags: app.tags.join(", "),
      url: app.url,
      icon: app.icon,
      private: app.private,
      expectStatus: app.expectStatus ?? "",
      checkType: app.checkType ?? "http",
      port: app.port != null ? String(app.port) : "",
      keyword: app.keyword ?? "",
      jsonQuery: app.jsonQuery ?? "",
      certWarnDays: app.certWarnDays != null ? String(app.certWarnDays) : "",
      monitor: app.monitor !== false,
      interval: app.interval != null ? String(app.interval) : "",
      timeout: app.timeout != null ? String(app.timeout) : "",
      retries: app.retries != null ? String(app.retries) : "",
    });
    setUpMode(modeFromExpect(app.expectStatus ?? ""));
    revealForm();
  }

  function resetForm() {
    setEditingId(null);
    setMethodChosen(false);
    setForm(emptyForm);
    setUpMode("any");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Only send the fields relevant to the chosen check method; clear the
      // others (so switching method doesn't leave a stale keyword/expectStatus
      // applying). Optional numbers go as numbers when entered; a blank one is
      // sent as null when editing, which clears it back to the default (an
      // omitted field would keep the stored value).
      const optionalNumber = (v: string, applies = true) =>
        applies && v.trim() ? Number(v) : editingId ? null : undefined;
      const payload = {
        name: form.name,
        subtitle: form.subtitle,
        groupName: form.groupName,
        tags: form.tags.split(","),
        url: withHttpScheme(form.url),
        icon: form.icon,
        private: form.private,
        monitor: form.monitor,
        checkType: form.checkType,
        expectStatus: form.checkType === "http" ? form.expectStatus : "",
        keyword: form.checkType === "keyword" ? form.keyword : "",
        jsonQuery: form.checkType === "json" ? form.jsonQuery : "",
        port: optionalNumber(form.port, form.checkType === "tcp" || form.checkType === "dns"),
        certWarnDays: optionalNumber(
          form.certWarnDays,
          form.checkType === "tls" || (watchesCert(form.checkType) && isHttps(form.url))
        ),
        interval: optionalNumber(form.interval),
        timeout: optionalNumber(form.timeout),
        retries: optionalNumber(form.retries),
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
      // Naming a group that didn't exist created it server-side.
      if (saved.group && !groups.some((g) => g.id === saved.group)) void refreshGroups();
      const wasEditing = editingId;
      setApps((prev) =>
        wasEditing ? prev.map((a) => (a.id === wasEditing ? saved : a)) : [...prev, saved]
      );
      if (!wasEditing && saved.checkType === "push") {
        // Stay on the new app so its freshly minted push URL shows (#294).
        startEdit(saved);
        toast("Application added — copy its push URL below");
      } else {
        resetForm();
        toast(wasEditing ? "Application updated" : "Application added");
      }
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const index = apps.findIndex((a) => a.id === id);
    const removed = index >= 0 ? apps[index] : undefined;
    const name = removed?.name;
    const ok = await confirm({
      title: name ? `Delete “${name}”?` : "Delete this application?",
      message: "It's removed from the dashboard, search, and the status page.",
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
    if (!removed) {
      toast("Application deleted");
      return;
    }
    // Undo restores the same row (same id, so history and favorites still
    // match) at its old position (#307).
    toast(`Deleted “${removed.name}”`, "success", {
      label: "Undo",
      onClick: () => void undoDelete(removed, index),
    });
  }

  async function undoDelete(item: AppItem, index: number) {
    try {
      const res = await fetch("/api/apps/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, index }),
      });
      if (!res.ok) throw new Error();
      setApps(await res.json());
      toast(`Restored “${item.name}”`);
    } catch {
      toast("Couldn't undo the delete", "error");
    }
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

  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Ticked apps that still exist (one may have been deleted meanwhile).
  const selectedIds = apps.filter((a) => selected.has(a.id)).map((a) => a.id);

  // Bulk-assign (#299): move the ticked apps to a group, or tag them.
  async function bulkUpdate(change: { groupName?: string; addTags?: string[] }) {
    try {
      const res = await fetch("/api/apps/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, ...change }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(apiErrorMessage(data, "Couldn't update the apps"), "error");
        return;
      }
      setApps(data.apps);
      setGroups(data.groups);
      const n = selectedIds.length;
      const what = n === 1 ? "1 app" : `${n} apps`;
      toast(
        change.groupName !== undefined
          ? change.groupName.trim()
            ? `Moved ${what} to ${change.groupName.trim()}`
            : `Took ${what} out of their groups`
          : `Tagged ${what}`
      );
      setSelected(new Set());
    } catch {
      toast("Couldn't update the apps", "error");
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
      <div className="space-y-3">
        {/* Keeps the heading outline h1 → h2 → h3 for screen readers (#274). */}
        <h2 className="sr-only">Your applications</h2>
        {/* Phones stack the form below the list; this jumps to it (#272). */}
        <div className="lg:hidden">
          <AddButton
            onClick={() => {
              resetForm();
              revealForm();
            }}
          >
            + Add application
          </AddButton>
        </div>
        {apps.length === 0 && (
          <p className="text-sm text-ink-40">No applications yet. Add your first one.</p>
        )}
        {selectedIds.length > 0 && (
          <BulkBar
            count={selectedIds.length}
            onMove={(name) => void bulkUpdate({ groupName: name })}
            onTag={(tag) => void bulkUpdate({ addTags: [tag] })}
            onClear={() => setSelected(new Set())}
          />
        )}
        {apps.map((app, index) => (
          <div
            key={app.id}
            {...handlers(index)}
            className={`flex items-center justify-between gap-4 ${subCardClasses} px-4 py-3 transition-colors ${dropIndicatorClass(
              index,
              { dragIndex, overIndex, dropEdge }
            )} ${dragIndex === index ? "opacity-50" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <input
                type="checkbox"
                checked={selected.has(app.id)}
                onChange={() => toggleSelected(app.id)}
                aria-label={`Select ${app.name}`}
                className="h-4 w-4 shrink-0 accent-[var(--accent-from)] pointer-coarse:h-5 pointer-coarse:w-5"
              />
              <MoveButtons index={index} count={apps.length} label={app.name} onMove={move} />
              <DragGrip {...grip(index)} />
              <Icon icon={app.icon} name={app.name} size={24} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {/* min-w-0: a flex item won't shrink below its content, so
                      truncate can't clip without it */}
                  <span className="min-w-0 truncate">{app.name}</span>
                  {app.private && <PrivateChip />}
                  {statusChecksEnabled && app.monitor === false && <UnmonitoredChip />}
                </p>
                <p className="truncate text-xs text-ink-40">
                  {app.subtitle ? `${app.subtitle} · ${app.url}` : app.url}
                </p>
                {(app.group || app.tags.length > 0) && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-55">
                    {app.group && <GroupChip group={groups.find((g) => g.id === app.group)} name={groupName(groups, app.group)} />}
                    {app.tags.map((t) => (
                      <span key={t} className="rounded-full bg-fg/[0.06] px-2 py-0.5">
                        #{t}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => startEdit(app)}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                size="sm"
                type="button"
                onClick={() => handleDelete(app.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div ref={formRef} className="h-fit scroll-mt-6">
        <Card title={editingId ? "Edit application" : "Add application"}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              // A bare host ("plex.local:32400") gets http:// (#277). The
              // check method is guessed from what was typed, before that.
              onBlur={(e) =>
                setForm({
                  ...form,
                  url: withHttpScheme(e.target.value),
                  checkType: methodChosen ? form.checkType : guessCheckType(e.target.value),
                })
              }
            />
            <IconField
              value={form.icon}
              onChange={(v) => setForm({ ...form, icon: v })}
              name={form.name}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Group"
                list="app-groups"
                placeholder="None"
                hint="An apps widget can show one group."
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
              />
              <TextField
                label="Tags"
                list="app-tags"
                placeholder="e.g. video, admin"
                hint="Comma-separated."
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </div>
            <datalist id="app-groups">
              {groups.map((g) => (
                <option key={g.id} value={g.name} />
              ))}
            </datalist>
            <datalist id="app-tags">
              {allTags(apps).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <ToggleRow
              label="Only show when logged in"
              hint="Hides this app from signed-out visitors everywhere, including the status page. It's still monitored and alerted on."
              checked={form.private}
              onChange={(v) => setForm({ ...form, private: v })}
            />
            <ToggleRow
              label="Monitor this app"
              hint="Check it with the status checks: a status dot, a row on the status page, and alerts. Off for things that don't need watching."
              checked={form.monitor}
              onChange={(v) => setForm({ ...form, monitor: v })}
            />
            {form.monitor && (
              <>
                {/* The per-app check settings only matter once checks are on;
                    say so rather than let them look live (#277). */}
                {!statusChecksEnabled && (
                  <p className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-xs text-ink-70">
                    Status checks are off, so these settings won&apos;t run yet. Turn
                    them on in the{" "}
                    <a
                      href="/admin?tab=settings&section=monitoring"
                      className="underline underline-offset-2 hover:text-fg"
                    >
                      Monitoring settings
                    </a>
                    .
                  </p>
                )}
                <SelectField
                  label="Check method"
                  hint={checkTypeHint(form.checkType)}
                  value={form.checkType}
                  onChange={(e) => {
                    setMethodChosen(true);
                    setForm({ ...form, checkType: e.target.value as CheckType });
                  }}
                >
                  {CHECK_TYPES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </SelectField>

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

                {form.checkType === "tls" && (
                  <TextField
                    label="Warn before expiry (days)"
                    type="number"
                    min={1}
                    max={365}
                    placeholder="14 (default)"
                    value={form.certWarnDays}
                    onChange={(e) => setForm({ ...form, certWarnDays: e.target.value })}
                    hint="The app shows a warning this many days before its certificate expires. Uses the URL's port, or 443."
                  />
                )}

                {form.checkType === "push" && (
                  <PushUrl token={apps.find((a) => a.id === editingId)?.pushToken ?? ""} />
                )}

                {form.checkType === "json" && (
                  <TextField
                    label="JSON query"
                    placeholder='$.status == "ok"'
                    value={form.jsonQuery}
                    onChange={(e) => setForm({ ...form, jsonQuery: e.target.value })}
                    hint={
                      form.jsonQuery.trim() && "error" in parseJsonQuery(form.jsonQuery) ? (
                        <span className="text-red-400">
                          {(parseJsonQuery(form.jsonQuery) as { error: string }).error}
                        </span>
                      ) : (
                        "A path from $, then optionally ==, !=, <, >, <= or >= and a value. Without a comparison the field just has to be there and truthy."
                      )
                    }
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
                    <span className={fieldLabelClasses}>Counts as up when</span>
                    <ChipGroup
                      label="Counts as up when"
                      equal
                      options={
                        [
                          { value: "any", label: "Any response" },
                          { value: "ok", label: "2xx & 3xx" },
                          { value: "custom", label: "Custom" },
                        ] as const
                      }
                      value={upMode}
                      onChange={(key) => {
                        setUpMode(key);
                        if (key === "any") setForm({ ...form, expectStatus: "" });
                        else if (key === "ok")
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
                    />
                    {upMode === "custom" && (
                      <input
                        value={form.expectStatus}
                        onChange={(e) =>
                          setForm({ ...form, expectStatus: e.target.value })
                        }
                        placeholder="e.g. 200-299, 401"
                        className={`${controlClasses} text-sm`}
                      />
                    )}
                    <Hint>
                      {upMode === "any"
                        ? "Any reachable host counts as up — even a 4xx/5xx response."
                        : upMode === "ok"
                          ? "Up only on a 2xx or 3xx response."
                          : "Up only when the response code is in these codes/ranges — e.g. mark a 404 as down."}
                    </Hint>
                  </div>
                )}
                {/* Per-app overrides of the global check settings (#292), tucked
                    away: the defaults suit almost every app. */}
                <details
                  className="rounded-lg border border-fg/10 px-3 py-2"
                  open={Boolean(
                    form.interval ||
                      form.timeout ||
                      form.retries ||
                      (form.certWarnDays && form.checkType !== "tls")
                  )}
                >
                  <summary className="cursor-pointer text-sm text-ink-70 select-none">
                    Advanced check settings
                  </summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <TextField
                      label="Interval (min)"
                      type="number"
                      min={1}
                      max={60}
                      placeholder={`${statusInterval} (default)`}
                      value={form.interval}
                      onChange={(e) => setForm({ ...form, interval: e.target.value })}
                    />
                    <TextField
                      label="Timeout (s)"
                      type="number"
                      min={1}
                      max={60}
                      placeholder="5 (default)"
                      value={form.timeout}
                      onChange={(e) => setForm({ ...form, timeout: e.target.value })}
                    />
                    <TextField
                      label="Retries"
                      type="number"
                      min={0}
                      max={5}
                      placeholder="0 (default)"
                      value={form.retries}
                      onChange={(e) => setForm({ ...form, retries: e.target.value })}
                    />
                  </div>
                  <Hint>
                    How often this app is checked, how long a check may take, and how
                    many quick re-tries a failed check gets before it counts as down.
                    Leave blank to use the defaults.
                  </Hint>
                  {watchesCert(form.checkType) && isHttps(form.url) && (
                    <div className="mt-3">
                      <TextField
                        label="Certificate warning (days)"
                        type="number"
                        min={1}
                        max={365}
                        placeholder="Off"
                        value={form.certWarnDays}
                        onChange={(e) => setForm({ ...form, certWarnDays: e.target.value })}
                        hint="Also watch this site's TLS certificate, and show a warning this many days before it expires."
                      />
                    </div>
                  )}
                </details>
              </>
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
        </Card>
      </div>
    </div>
  );
}

// The bar over the app list while apps are ticked (#299): move them all to a
// group (typed: an existing one, or a new name; empty takes them out of
// their groups), or add a tag to each.
function BulkBar({
  count,
  onMove,
  onTag,
  onClear,
}: {
  count: number;
  onMove: (groupName: string) => void;
  onTag: (tag: string) => void;
  onClear: () => void;
}) {
  const [group, setGroup] = useState("");
  const [tag, setTag] = useState("");
  return (
    <div
      role="region"
      aria-label="Change the selected apps"
      className={`${subCardClasses} flex flex-wrap items-end gap-3 px-4 py-3 text-sm`}
    >
      <span className="self-center font-medium text-ink-80">
        {count === 1 ? "1 app selected" : `${count} apps selected`}
      </span>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onMove(group);
          setGroup("");
        }}
      >
        <input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          list="app-groups"
          placeholder="Group (empty for none)"
          aria-label="Group to move the selected apps to"
          className={`${controlClasses} w-48 py-1.5 text-sm`}
        />
        <Button type="submit" variant="ghost" size="sm">
          Move
        </Button>
      </form>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tag.trim()) return;
          onTag(tag);
          setTag("");
        }}
      >
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          list="app-tags"
          placeholder="Tag"
          aria-label="Tag to add to the selected apps"
          className={`${controlClasses} w-32 py-1.5 text-sm`}
        />
        <Button type="submit" variant="ghost" size="sm" disabled={!tag.trim()}>
          Add tag
        </Button>
      </form>
      <Button type="button" variant="ghost" size="sm" onClick={onClear} className="ml-auto">
        Clear selection
      </Button>
    </div>
  );
}

// An app's group, with the group's own icon and color when it has them (#316).
function GroupChip({ group, name }: { group?: Group; name: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-fg/15 px-2 py-0.5 ${
        group?.color ? `group-color-${group.color}` : ""
      }`}
    >
      {group?.icon && <Icon icon={group.icon} name={name} size={12} />}
      {name}
    </span>
  );
}
