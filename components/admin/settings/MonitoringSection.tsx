"use client";

import { WEBHOOK_SERVICES } from "@/lib/schema";
import { activeChannels, channelLabel } from "@/lib/alert-channels";
import { STATUS_RANGES } from "@/lib/status";
import {
  AddButton,
  Card,
  ControlRow,
  Hint,
  NumberRow,
  TextField,
  ToggleRow,
  fieldLabelClasses,
} from "../ui";
import { ChipGroup } from "@/components/ChipGroup";
import { WEBHOOK_LABELS, WebhookUrlRow } from "./WebhookUrlRow";
import { AlertChannelEditor } from "./AlertChannelEditor";
import WebhookPreview from "./WebhookPreview";
import { DIGEST_PRESETS, INTERVAL_PRESETS, digestPresetLabel } from "./constants";
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
        intro="Let Sonarr, Radarr, and Seerr push events — a grab, an import, a request needing approval, a health issue — to CtrlCenter, relayed out through the alert channels above. Each service has its own URL; paste it into that app's webhook connection."
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
            {/* A hand-edited value outside the presets (the schema allows
                0–300) shows as a read-only chip, as the uptime interval
                does, so the control never reads as "nothing selected". */}
            <ControlRow
              label="Group bursts for"
              hint="Events of one kind — a season's episodes, a batch of movies, a run of requests — that arrive within this long of each other go out as one notification. Off sends each as it arrives. Health issues, updates and a sender's Test are never held."
            >
              <ChipGroup
                label="Group bursts for"
                shrink
                options={DIGEST_PRESETS.map((s) => ({
                  value: s,
                  label: digestPresetLabel(s),
                }))}
                value={webhooks.digestSeconds}
                onChange={(digestSeconds) => updateWebhooks({ digestSeconds })}
                offLabel={(s) => `${s} s`}
              />
            </ControlRow>
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

            {/* What the email report carries (#347). The push and chat
                channels get the one-line summary whatever is set here. */}
            <div className="flex flex-col gap-3 border-t border-fg/10 pt-4">
              <div className="flex flex-col gap-1">
                <span className={fieldLabelClasses}>Email report</span>
                <Hint>
                  What an email channel shows for an event. Every other
                  channel gets the one-line summary.
                </Hint>
              </div>
              <ToggleRow
                label="Poster"
                hint="The show or movie poster. Your mail client fetches it from TheTVDB or TMDB when the email is opened."
                checked={webhooks.poster}
                onChange={(poster) => updateWebhooks({ poster })}
              />
              <ToggleRow
                label="Facts table"
                hint="Quality, size, release group, indexer, client, requester: the fields that matter for each event."
                checked={webhooks.facts}
                onChange={(facts) => updateWebhooks({ facts })}
              />
              <ToggleRow
                label="Synopsis"
                hint="The overview Radarr and Seerr send, or Sonarr's episode summary, which can spoil an episode."
                checked={webhooks.synopsis}
                onChange={(synopsis) => updateWebhooks({ synopsis })}
              />
              <TextField
                label="Subject prefix"
                hint="Put in front of every webhook email subject, e.g. a tag your mail rules file on. Counts toward the 78-character limit."
                maxLength={40}
                placeholder="[Home]"
                autoComplete="off"
                value={webhooks.subjectPrefix}
                onChange={(e) => updateWebhooks({ subjectPrefix: e.target.value })}
              />
            </div>

            {/* The preview renders the draft; its Send sample reads the
                saved config, so it also waits out a failed save. */}
            <WebhookPreview
              webhooks={webhooks}
              alerts={alerts}
              siteTitle={settings.title}
              timeZone={settings.timezone}
              saving={saving || status === "error"}
            />
          </>
        )}
      </Card>
    </>
  );
}
