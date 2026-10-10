"use client";

import { useState } from "react";
import {
  API_DISPLAYS,
  MAX_API_FIELDS,
  MAX_API_HEADERS,
  MAX_API_REFRESH,
  MIN_API_REFRESH,
  type InstanceOf,
} from "@/lib/schema";
import type { ApiView } from "@/lib/api-widget";
import {
  AddButton,
  Button,
  Hint,
  ListPanel,
  NumberRow,
  RemoveButton,
  SelectField,
  TextArea,
  TextField,
  controlClasses,
} from "../../ui";
import type { InstanceEditorProps } from "./index";

type Api = InstanceOf<"api">;
type Field = Api["fields"][number];

const DISPLAY_LABELS: Record<Api["display"], string> = {
  stat: "A number (stat)",
  gauge: "A gauge",
  kv: "Key/value rows",
  list: "A list",
};

// An API widget's fields in admin Settings → Widgets (#302): where to fetch,
// what to pick out with JSONPath, how to show it and who sees it — and a Test
// button that shows the raw response beside what the paths pick.
export default function ApiSettings({ w, onChange }: InstanceEditorProps<"api">) {
  const api: Api = w;
  const fields = api.fields.length > 0 ? api.fields : [{ label: "", path: "", unit: "" }];
  const setField = (i: number, patch: Partial<Field>) =>
    onChange({ fields: fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const setThreshold = (key: "warn" | "critical", raw: string) =>
    onChange({
      thresholds: { ...api.thresholds, [key]: raw.trim() === "" || !Number.isFinite(Number(raw)) ? null : Number(raw) },
    });
  const single = api.display === "stat" || api.display === "gauge";
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <TextField
          label="URL"
          placeholder="http://nas.lan/api/pool"
          value={api.url}
          onChange={(e) => onChange({ url: e.target.value })}
        />
        <SelectField
          label="Method"
          value={api.method}
          onChange={(e) => onChange({ method: e.target.value === "POST" ? "POST" : "GET" })}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </SelectField>
      </div>
      <ListPanel label="Headers">
        {api.headers.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={h.name}
              onChange={(e) =>
                onChange({ headers: api.headers.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) })
              }
              placeholder="Authorization"
              aria-label={`Header ${i + 1} name`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <input
              type="password"
              autoComplete="off"
              value={h.value}
              onChange={(e) =>
                onChange({ headers: api.headers.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)) })
              }
              placeholder="Bearer ${NAS_TOKEN}"
              aria-label={`Header ${i + 1} value`}
              className={`${controlClasses} min-w-0 flex-1`}
            />
            <RemoveButton
              label={`Remove header ${i + 1}`}
              onClick={() => onChange({ headers: api.headers.filter((_, idx) => idx !== i) })}
            />
          </div>
        ))}
        {api.headers.length < MAX_API_HEADERS && (
          <AddButton onClick={() => onChange({ headers: [...api.headers, { name: "", value: "" }] })}>
            + Add header
          </AddButton>
        )}
      </ListPanel>
      <Hint>
        Keep secrets out of the config: a header value like{" "}
        <code>{"Bearer ${NAS_TOKEN}"}</code> reads the token from that
        environment variable on the server.
      </Hint>
      {api.method === "POST" && (
        <TextArea
          label="Body (JSON)"
          mono
          rows={4}
          value={api.body}
          onChange={(e) => onChange({ body: e.target.value })}
        />
      )}

      <SelectField
        label="Show it as"
        value={api.display}
        onChange={(e) => onChange({ display: e.target.value as Api["display"] })}
      >
        {API_DISPLAYS.map((d) => (
          <option key={d} value={d}>
            {DISPLAY_LABELS[d]}
          </option>
        ))}
      </SelectField>

      {api.display === "list" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="List path"
            placeholder="$.items"
            value={api.list.path}
            onChange={(e) => onChange({ list: { ...api.list, path: e.target.value } })}
          />
          <TextField
            label="Each item's label"
            placeholder="$.name"
            value={api.list.label}
            onChange={(e) => onChange({ list: { ...api.list, label: e.target.value } })}
          />
          <TextField
            label="Each item's value (optional)"
            placeholder="$.status"
            value={api.list.value}
            onChange={(e) => onChange({ list: { ...api.list, value: e.target.value } })}
          />
        </div>
      ) : (
        <ListPanel label={single ? "Value" : "Rows"}>
          {(single ? fields.slice(0, 1) : fields).map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })}
                placeholder="Label"
                aria-label={`Field ${i + 1} label`}
                className={`${controlClasses} min-w-0 flex-1 basis-28`}
              />
              <input
                value={f.path}
                onChange={(e) => setField(i, { path: e.target.value })}
                placeholder="$.used_pct"
                aria-label={`Field ${i + 1} JSONPath`}
                className={`${controlClasses} min-w-0 flex-[2] basis-40 font-mono text-xs`}
              />
              <input
                value={f.unit}
                onChange={(e) => setField(i, { unit: e.target.value })}
                placeholder="Unit"
                aria-label={`Field ${i + 1} unit`}
                className={`${controlClasses} w-20`}
              />
              {!single && fields.length > 1 && (
                <RemoveButton
                  label={`Remove field ${i + 1}`}
                  onClick={() => onChange({ fields: fields.filter((_, idx) => idx !== i) })}
                />
              )}
            </div>
          ))}
          {!single && fields.length < MAX_API_FIELDS && (
            <AddButton onClick={() => onChange({ fields: [...fields, { label: "", path: "", unit: "" }] })}>
              + Add row
            </AddButton>
          )}
        </ListPanel>
      )}
      <Hint>
        Paths pick a field out of the JSON: <code>$.status</code>,{" "}
        <code>$.pools[0].used</code>, <code>{`$["disk usage"]`}</code>. In a
        list, an item&apos;s paths start from the item.
      </Hint>

      {single && (
        <div className="grid gap-4 sm:grid-cols-3">
          {api.display === "gauge" && (
            <TextField
              label="Full at"
              inputMode="decimal"
              value={String(api.max)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) onChange({ max: n });
              }}
            />
          )}
          <TextField
            label="Warn at"
            inputMode="decimal"
            placeholder="None"
            value={api.thresholds.warn ?? ""}
            onChange={(e) => setThreshold("warn", e.target.value)}
          />
          <TextField
            label="Critical at"
            inputMode="decimal"
            placeholder="None"
            value={api.thresholds.critical ?? ""}
            onChange={(e) => setThreshold("critical", e.target.value)}
          />
          <SelectField
            label="Counting"
            value={api.thresholds.direction}
            onChange={(e) =>
              onChange({ thresholds: { ...api.thresholds, direction: e.target.value === "below" ? "below" : "above" } })
            }
          >
            <option value="above">Up (at or above)</option>
            <option value="below">Down (at or below)</option>
          </SelectField>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Card title"
          placeholder="API"
          value={api.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <SelectField
          label="Who sees it"
          value={api.visibility}
          onChange={(e) => onChange({ visibility: e.target.value === "public" ? "public" : "admin" })}
        >
          <option value="admin">Only me</option>
          <option value="public">Everyone</option>
        </SelectField>
      </div>
      <NumberRow
        label="Refresh every (seconds)"
        min={MIN_API_REFRESH}
        max={MAX_API_REFRESH}
        value={api.refresh}
        onChange={(refresh) => onChange({ refresh })}
      />
      <ApiTest widget={api} />
    </>
  );
}

type TestResult = { ok: boolean; raw?: string; view?: ApiView; error?: string };

// Fetch with the form's values and show the raw response and what the paths
// picked out of it.
function ApiTest({ widget }: { widget: Api }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/widgets/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widget }),
      });
      setResult(res.ok ? await res.json() : { ok: false, error: `HTTP ${res.status}` });
    } catch {
      setResult({ ok: false, error: "Network error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="ghost" size="sm" className="self-start" disabled={busy || !widget.url.trim()} onClick={run}>
        {busy ? "Testing…" : "Test"}
      </Button>
      {result && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-60">Response</span>
            <pre className="max-h-64 overflow-auto rounded-lg bg-fg/[0.06] p-2 font-mono text-[11px] text-ink-70">
              {result.raw ?? "—"}
            </pre>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-60">What the widget shows</span>
            {result.ok && result.view ? (
              <ul className="flex flex-col gap-1 text-sm">
                {"rows" in result.view ? (
                  result.view.rows.map((r, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate text-ink-70">{r.label}</span>
                      <span className="font-medium text-ink-90">{r.value}</span>
                    </li>
                  ))
                ) : (
                  <li className="flex justify-between gap-3">
                    <span className="text-ink-70">{result.view.label || "Value"}</span>
                    <span className="font-medium text-ink-90">
                      {result.view.value}
                      {result.view.unit ? ` ${result.view.unit}` : ""}
                      {result.view.tone !== "ok" ? ` (${result.view.tone})` : ""}
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <span className="text-xs text-status-down">✗ {result.error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
