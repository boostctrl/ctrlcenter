"use client";

import type { Settings } from "@/lib/schema";
import { ALERT_TYPES, WEBHOOK_SERVICES } from "@/lib/schema";
import { STATUS_RANGES } from "@/lib/status";
import { Card, ControlRow, NumberField, NumberRow, SelectField, TextField, ToggleRow } from "../ui";
import { ChipGroup } from "@/components/ChipGroup";
import AlertTest from "../AlertTest";
import { WEBHOOK_LABELS, WebhookUrlRow } from "./WebhookUrlRow";
import { INTERVAL_PRESETS } from "./constants";
import type { SettingsDraft } from "./useSettingsDraft";

export default function MonitoringSection({ d }: { d: SettingsDraft }) {
  const {
    settings,
    setSettings,
    alerts,
    updateAlerts,
    updateAlertEmail,
    webhooks,
    updateWebhooks,
    updateWebhookService,
    genWebhookToken,
    toggleWebhookService,
    alertTypeLabel,
    alertUrlPlaceholder,
  } = d;
  return (
    <>
      <Card
        title="Status checks"
        intro="Show an online/offline dot on each app and record its uptime. The server pings every app URL, so leave off if your apps aren't reachable from it."
        toggle={{
          checked: settings.statusChecks,
          onChange: (statusChecks) =>
            setSettings({ ...settings, statusChecks }),
        }}
      >
        {settings.statusChecks && (
          <>
            {/* A hand-edited config value (the schema allows 1–60) matches
                no preset; `offLabel` surfaces it as a read-only chip so the
                control never reads as "nothing selected". */}
            <ControlRow
              label="Uptime check interval"
              hint="How often the server records each app's up/down for the 90-day history on the status page."
            >
              <ChipGroup
                label="Uptime check interval"
                shrink
                options={INTERVAL_PRESETS.map((m) => ({
                  value: m,
                  label: `${m} min`,
                }))}
                value={settings.statusInterval}
                onChange={(m) => setSettings({ ...settings, statusInterval: m })}
                offLabel={(m) => `${m} min`}
              />
            </ControlRow>

            <ControlRow
              label="Default status range"
              hint="Which time range the status page opens on."
            >
              <ChipGroup
                label="Default status range"
                shrink
                options={STATUS_RANGES.map((r) => ({
                  value: r.key,
                  label: r.label,
                }))}
                value={settings.statusDefaultRange}
                onChange={(r) =>
                  setSettings({ ...settings, statusDefaultRange: r })
                }
              />
            </ControlRow>
          </>
        )}
      </Card>

      <Card
        title="Alerts"
        intro="Notify a webhook and/or email when an app goes down or recovers. Requires the status checks to be on."
        toggle={{
          checked: alerts.enabled,
          onChange: (enabled) => updateAlerts({ enabled }),
        }}
      >
        {alerts.enabled && (
          <>
            <ToggleRow
              label="Notify on recovery"
              checked={alerts.notifyOnRecovery}
              onChange={(notifyOnRecovery) =>
                updateAlerts({ notifyOnRecovery })
              }
            />

            <NumberRow
              label="Confirmations before down"
              hint="Consecutive failed checks required first."
              min={1}
              max={10}
              value={alerts.confirmations}
              onChange={(confirmations) => updateAlerts({ confirmations })}
            />

            {/* Two independent channels, each with its own toggle — enable
                either, both, or neither. */}
            <div className="mt-1 flex flex-col gap-3 border-t border-fg/10 pt-4">
              <ToggleRow
                label="Webhook"
                hint="Post to a generic JSON endpoint, Discord, Slack, or ntfy."
                checked={alerts.webhookEnabled}
                onChange={(webhookEnabled) =>
                  updateAlerts({ webhookEnabled })
                }
              />
              {alerts.webhookEnabled && (
                <div className="flex flex-col gap-3">
                  <SelectField
                    label="Notify via"
                    value={alerts.type}
                    onChange={(e) =>
                      updateAlerts({
                        type: e.target.value as Settings["alerts"]["type"],
                      })
                    }
                  >
                    {ALERT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {alertTypeLabel[t]}
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    label="Webhook URL"
                    placeholder={alertUrlPlaceholder[alerts.type]}
                    value={alerts.webhookUrl}
                    onChange={(e) => updateAlerts({ webhookUrl: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-fg/10 pt-4">
              <ToggleRow
                label="Email (SMTP)"
                hint="Optional — email on down/recovery, independent of the webhook. Works with any SMTP service (SMTP2GO, Gmail, Fastmail, a relay)."
                checked={alerts.email.enabled}
                onChange={(enabled) => updateAlertEmail({ enabled })}
              />

              {alerts.email.enabled && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <TextField
                        label="SMTP host"
                        placeholder="mail.smtp2go.com"
                        value={alerts.email.host}
                        onChange={(e) => updateAlertEmail({ host: e.target.value })}
                      />
                    </div>
                    <NumberField
                      label="Port"
                      min={1}
                      max={65535}
                      value={alerts.email.port}
                      onChange={(port) => updateAlertEmail({ port })}
                    />
                  </div>

                  <ToggleRow
                    label="Implicit TLS (port 465)"
                    hint="Leave off for 587/STARTTLS."
                    checked={alerts.email.secure}
                    onChange={(secure) => updateAlertEmail({ secure })}
                  />

                  <TextField
                    label="Username"
                    autoComplete="off"
                    value={alerts.email.user}
                    onChange={(e) => updateAlertEmail({ user: e.target.value })}
                  />
                  <TextField
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    value={alerts.email.pass}
                    onChange={(e) => updateAlertEmail({ pass: e.target.value })}
                    hint="Stored in config.yaml. Set the CTRLCENTER_SMTP_PASS env var to keep it out of the file instead."
                  />
                  <TextField
                    label="From address"
                    placeholder="ctrlcenter@yourdomain.com"
                    value={alerts.email.from}
                    onChange={(e) => updateAlertEmail({ from: e.target.value })}
                  />
                  <TextField
                    label="To address"
                    placeholder="you@example.com"
                    value={alerts.email.to}
                    onChange={(e) => updateAlertEmail({ to: e.target.value })}
                  />
                  <TextField
                    label="Subject"
                    placeholder="{service} is {status}"
                    value={alerts.email.subject}
                    onChange={(e) =>
                      updateAlertEmail({ subject: e.target.value })
                    }
                    hint={
                      <>
                        Variables: <code>{"{service}"}</code> and{" "}
                        <code>{"{status}"}</code> (down/up). Blank uses the
                        default.
                      </>
                    }
                  />
                  {!(
                    alerts.email.host.trim() &&
                    alerts.email.from.trim() &&
                    alerts.email.to.trim()
                  ) && (
                    <p className="text-xs text-amber-400/80">
                      Add an SMTP host and from/to addresses to start sending —
                      email stays off until then.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-fg/10 pt-4">
              <AlertTest
                webhookConfigured={
                  alerts.webhookEnabled && alerts.webhookUrl.trim() !== ""
                }
                emailConfigured={
                  alerts.email.enabled &&
                  alerts.email.host.trim() !== "" &&
                  alerts.email.from.trim() !== "" &&
                  alerts.email.to.trim() !== ""
                }
              />
            </div>
          </>
        )}
      </Card>

      <Card
        title="Inbound webhooks"
        intro="Let Sonarr, Radarr, and Overseerr push events — a grab, an import, a request needing approval, a health issue — to CtrlCenter, relayed out through the alert channels above. Each service has its own URL; paste it into that app's webhook connection."
        toggle={{
          checked: webhooks.enabled,
          onChange: (enabled) => updateWebhooks({ enabled }),
        }}
      >
        {webhooks.enabled && (
          <>
            {!(
              (alerts.webhookEnabled && alerts.webhookUrl.trim() !== "") ||
              (alerts.email.enabled &&
                alerts.email.host.trim() !== "" &&
                alerts.email.from.trim() !== "" &&
                alerts.email.to.trim() !== "")
            ) && (
              <p className="text-xs text-amber-400/80">
                Set up a webhook or email channel in Alerts above — inbound
                events have nowhere to go until then.
              </p>
            )}
            {WEBHOOK_SERVICES.map((svc) => {
              const w = webhooks[svc];
              return (
                <div
                  key={svc}
                  className="flex flex-col gap-3 border-t border-fg/10 pt-4"
                >
                  <ToggleRow
                    label={WEBHOOK_LABELS[svc]}
                    checked={w.enabled}
                    onChange={(enabled) => toggleWebhookService(svc, enabled)}
                  />
                  {w.enabled && (
                    <WebhookUrlRow
                      service={svc}
                      label={WEBHOOK_LABELS[svc]}
                      token={w.token}
                      onRegenerate={() =>
                        updateWebhookService(svc, { token: genWebhookToken() })
                      }
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
      </Card>
    </>
  );
}
