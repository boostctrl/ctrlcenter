"use client";

import { WEBHOOK_SERVICES } from "@/lib/schema";
import { activeChannels, channelLabel } from "@/lib/alert-channels";
import { STATUS_RANGES } from "@/lib/status";
import {
  AddButton,
  Card,
  ControlRow,
  NumberRow,
  ToggleRow,
  fieldLabelClasses,
} from "../ui";
import { ChipGroup } from "@/components/ChipGroup";
import { WEBHOOK_LABELS, WebhookUrlRow } from "./WebhookUrlRow";
import { AlertChannelEditor } from "./AlertChannelEditor";
import { INTERVAL_PRESETS } from "./constants";
import type { SettingsDraft } from "./useSettingsDraft";

export default function MonitoringSection({
  d,
  apps,
}: {
  d: SettingsDraft;
  apps: { id: string; name: string }[];
}) {
  const {
    settings,
    setSettings,
    alerts,
    updateAlerts,
    addChannel,
    updateChannel,
    removeChannel,
    status,
    webhooks,
    updateWebhooks,
    updateWebhookService,
    genWebhookToken,
    toggleWebhookService,
    alertTypeLabel,
    alertUrlPlaceholder,
  } = d;
  // A Send test waits out a pending autosave so it never tests old values.
  const saving = status === "saving";
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
              hint="How often the server checks each app. The dashboard's status dots, the status page and its 90-day history all show these checks."
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
        intro="Notify you when an app goes down or recovers, through as many channels as you like. Requires the status checks to be on."
        toggle={{
          checked: alerts.enabled,
          onChange: (enabled) => updateAlerts({ enabled }),
        }}
      >
        {alerts.enabled && (
          <>
            <NumberRow
              label="Confirmations before down"
              hint="Consecutive failed checks required first."
              min={1}
              max={10}
              value={alerts.confirmations}
              onChange={(confirmations) => updateAlerts({ confirmations })}
            />

            <div className="flex flex-col gap-2">
              <span className={fieldLabelClasses}>Channels</span>
              {alerts.channels.length === 0 && (
                <p className="text-xs text-ink-45">
                  Add a channel to start sending: a webhook (Discord, Slack,
                  ntfy or your own), email, Telegram, Gotify, Pushover, or an
                  Apprise server for anything else.
                </p>
              )}
              {alerts.channels.map((ch) => (
                <AlertChannelEditor
                  key={ch.id}
                  channel={ch}
                  apps={apps}
                  saving={saving}
                  formatLabel={alertTypeLabel}
                  urlPlaceholder={alertUrlPlaceholder}
                  onChange={(patch) => updateChannel(ch.id, patch)}
                  onRemove={() => removeChannel(ch.id, channelLabel(ch))}
                />
              ))}
              <AddButton onClick={addChannel}>+ Add channel</AddButton>
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
            {!activeChannels(alerts).some((ch) => ch.onWebhooks) && (
              <p className="text-xs text-status-warning">
                Add an alert channel that sends inbound webhooks, in Alerts
                above. Events have nowhere to go until then.
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
