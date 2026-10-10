"use client";

import type { AlertChannel, AlertType } from "@/lib/schema";
import { ALERT_TYPES, CHANNEL_TYPES } from "@/lib/schema";
import { CHANNEL_LABELS, channelLabel, missingFields } from "@/lib/alert-channels";
import { ChipGroup, ChipToggles } from "@/components/ChipGroup";
import {
  ControlRow,
  NumberField,
  RemoveButton,
  SelectField,
  Switch,
  TextField,
  ToggleRow,
  fieldLabelClasses,
  subCardClasses,
} from "../ui";
import AlertTest from "../AlertTest";

type Event = "onDown" | "onRecovery" | "onWarning" | "onWebhooks";
const EVENTS: { value: Event; label: string }[] = [
  { value: "onDown", label: "Down" },
  { value: "onRecovery", label: "Recovered" },
  { value: "onWarning", label: "Warnings" },
  { value: "onWebhooks", label: "Inbound webhooks" },
];

// One entry of the alert channel list (#291): its type, the fields that type
// needs, which events and apps it takes, and its own Send test.
export function AlertChannelEditor({
  channel: ch,
  apps,
  saving,
  formatLabel,
  urlPlaceholder,
  onChange,
  onRemove,
}: {
  channel: AlertChannel;
  // The monitored apps, for the app filter.
  apps: { id: string; name: string }[];
  saving: boolean;
  formatLabel: Record<AlertType, string>;
  urlPlaceholder: Record<AlertType, string>;
  onChange: (patch: Partial<AlertChannel>) => void;
  onRemove: () => void;
}) {
  const label = channelLabel(ch);
  const missing = missingFields(ch);
  const smtp = (patch: Partial<AlertChannel["smtp"]>) => onChange({ smtp: { ...ch.smtp, ...patch } });
  // An app filter naming apps that no longer exist (deleted since) still
  // counts as "only some", so the chips show and the stale ids can be cleared.
  const someApps = ch.apps.length > 0;

  return (
    <div className={`${subCardClasses} flex flex-col gap-3 p-3`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${fieldLabelClasses} truncate`}>{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer items-center">
            <Switch
              checked={ch.enabled}
              onChange={(enabled) => onChange({ enabled })}
              label={`${label} enabled`}
            />
          </label>
          <RemoveButton label={`Remove ${label}`} onClick={onRemove} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Service"
          value={ch.type}
          onChange={(e) => onChange({ type: e.target.value as AlertChannel["type"] })}
        >
          {CHANNEL_TYPES.map((t) => (
            <option key={t} value={t}>
              {CHANNEL_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Name"
          placeholder={CHANNEL_LABELS[ch.type]}
          value={ch.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <ChannelFields
        ch={ch}
        onChange={onChange}
        smtp={smtp}
        formatLabel={formatLabel}
        urlPlaceholder={urlPlaceholder}
      />

      <div className="flex flex-col gap-1.5">
        <span className={fieldLabelClasses}>Send on</span>
        <ChipToggles
          label={`${label}: events`}
          options={EVENTS}
          selected={EVENTS.filter((e) => ch[e.value]).map((e) => e.value)}
          onChange={(on) =>
            onChange(Object.fromEntries(EVENTS.map((e) => [e.value, on.includes(e.value)])))
          }
        />
      </div>

      <ControlRow label="Apps" hint="Which apps' outages reach this channel.">
        <ChipGroup
          label={`${label}: apps`}
          shrink
          options={[
            { value: "all", label: "All" },
            { value: "some", label: "Only some" },
          ]}
          value={someApps ? "some" : "all"}
          onChange={(v) =>
            // "Only some" starts with the first app picked, so the choice sticks.
            onChange({ apps: v === "all" ? [] : apps.slice(0, 1).map((a) => a.id) })
          }
        />
      </ControlRow>
      {someApps && (
        <ChipToggles
          label={`${label}: alert for`}
          options={apps.map((a) => ({ value: a.id, label: a.name }))}
          selected={ch.apps}
          onChange={(ids) => onChange({ apps: ids })}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AlertTest channel={ch.id} ready={missing.length === 0} saving={saving} />
        {missing.length > 0 && (
          <p className="text-xs text-status-warning">
            Add {andList(missing)} to start sending.
          </p>
        )}
      </div>
    </div>
  );
}

// "a, b and c".
function andList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function ChannelFields({
  ch,
  onChange,
  smtp,
  formatLabel,
  urlPlaceholder,
}: {
  ch: AlertChannel;
  onChange: (patch: Partial<AlertChannel>) => void;
  smtp: (patch: Partial<AlertChannel["smtp"]>) => void;
  formatLabel: Record<AlertType, string>;
  urlPlaceholder: Record<AlertType, string>;
}) {
  const url = (label: string, placeholder: string, hint?: string) => (
    <TextField
      label={label}
      placeholder={placeholder}
      value={ch.url}
      onChange={(e) => onChange({ url: e.target.value })}
      hint={hint}
    />
  );
  const secret = (key: "token" | "userKey" | "chatId", label: string, hint?: string) => (
    <TextField
      label={label}
      type="password"
      autoComplete="new-password"
      value={ch[key]}
      onChange={(e) => onChange({ [key]: e.target.value })}
      hint={hint}
    />
  );

  switch (ch.type) {
    case "webhook":
      return (
        <>
          <SelectField
            label="Format"
            value={ch.format}
            onChange={(e) => onChange({ format: e.target.value as AlertType })}
          >
            {ALERT_TYPES.map((t) => (
              <option key={t} value={t}>
                {formatLabel[t]}
              </option>
            ))}
          </SelectField>
          {url("Webhook URL", urlPlaceholder[ch.format])}
        </>
      );
    case "telegram":
      return (
        <>
          {secret("token", "Bot token", "From @BotFather when you create the bot.")}
          <TextField
            label="Chat ID"
            placeholder="123456789"
            value={ch.chatId}
            onChange={(e) => onChange({ chatId: e.target.value })}
            hint="Message the bot first. A group or channel ID starts with -."
          />
        </>
      );
    case "gotify":
      return (
        <>
          {url("Server URL", "https://gotify.example.com")}
          {secret("token", "App token", "Create an application in Gotify for CtrlCenter.")}
        </>
      );
    case "pushover":
      return (
        <>
          {secret("token", "API token", "Register CtrlCenter as an application in Pushover.")}
          {secret("userKey", "User key", "Your user key, or a delivery group's key.")}
        </>
      );
    case "apprise":
      return url(
        "Apprise API URL",
        "http://apprise:8000/notify/ctrlcenter",
        "The notify endpoint of an Apprise API server, which forwards to the services set up there."
      );
    case "email":
      return (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <TextField
                label="SMTP host"
                placeholder="mail.smtp2go.com"
                value={ch.smtp.host}
                onChange={(e) => smtp({ host: e.target.value })}
              />
            </div>
            <NumberField
              label="Port"
              min={1}
              max={65535}
              value={ch.smtp.port}
              onChange={(port) => smtp({ port })}
            />
          </div>
          <ToggleRow
            label="Implicit TLS (port 465)"
            hint="Leave off for 587/STARTTLS."
            checked={ch.smtp.secure}
            onChange={(secure) => smtp({ secure })}
          />
          <TextField
            label="Username"
            autoComplete="off"
            value={ch.smtp.user}
            onChange={(e) => smtp({ user: e.target.value })}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            value={ch.smtp.pass}
            onChange={(e) => smtp({ pass: e.target.value })}
            hint="Stored in config.yaml. Set the CTRLCENTER_SMTP_PASS env var to keep it out of the file instead."
          />
          <TextField
            label="From address"
            placeholder="ctrlcenter@yourdomain.com"
            value={ch.smtp.from}
            onChange={(e) => smtp({ from: e.target.value })}
          />
          <TextField
            label="To address"
            placeholder="you@example.com"
            value={ch.smtp.to}
            onChange={(e) => smtp({ to: e.target.value })}
          />
          <TextField
            label="Subject"
            placeholder="{service} is {status}"
            value={ch.smtp.subject}
            onChange={(e) => smtp({ subject: e.target.value })}
            hint={
              <>
                Variables: <code>{"{service}"}</code> and <code>{"{status}"}</code> (down/up).
                Blank uses the default.
              </>
            }
          />
        </>
      );
  }
}
