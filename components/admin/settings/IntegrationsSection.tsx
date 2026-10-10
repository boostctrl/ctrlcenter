"use client";

import { useState } from "react";
import { integrationLabels, SERVICE_IDS, SERVICE_META, type ServiceId } from "@/lib/services/ids";
import { Button, Card, Hint, MoveButtons, RemoveButton, TextField, ToggleRow, controlClasses } from "../ui";
import IntegrationTest from "../IntegrationTest";
import type { SettingsDraft } from "./useSettingsDraft";

// The Integrations tab (#300): every connection to a self-hosted service, any
// number of each type (a 4K Sonarr beside an HD one), each its own card with
// a name, its credentials, the type's opt-ins, a Test button, and Remove.
// The cards read each type's copy and credential shape from SERVICE_META.
export default function IntegrationsSection({ d }: { d: SettingsDraft }) {
  const { integrations, updateIntegration, addIntegration, moveIntegration, removeIntegration } = d;
  const [type, setType] = useState<ServiceId>("sonarr");
  const labels = integrationLabels(integrations);
  return (
    <>
      <Card
        title="Add an integration"
        intro="Connect a service to the private Monitor page. Add as many of each as you run — two Sonarrs, a Portainer per host."
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ServiceId)}
            aria-label="Integration type"
            className={controlClasses}
          >
            {SERVICE_IDS.map((id) => (
              <option key={id} value={id}>
                {SERVICE_META[id].label}
              </option>
            ))}
          </select>
          <Button type="button" variant="ghost" size="sm" onClick={() => addIntegration(type)}>
            Add
          </Button>
        </div>
        <Hint>
          Any field can name an environment variable instead of holding the
          secret: write <code>{"${SONARR_4K_KEY}"}</code> and set that variable
          for the container. It&apos;s read on the server and never shown here.
        </Hint>
      </Card>

      {integrations.length === 0 && (
        <Card title="No integrations yet" intro="Add one above to see it on the Monitor page." />
      )}

      {integrations.map((i, index) => {
        const meta = SERVICE_META[i.type];
        const label = labels[i.id];
        const update = (patch: Parameters<typeof updateIntegration>[1]) => updateIntegration(i.id, patch);
        // The pre-3.0 variable still applies to the integration with the
        // type's own id (the one a 2.x config migrated to).
        const legacy = i.id === i.type ? meta.legacyEnv : null;
        return (
          <Card
            key={i.id}
            title={label}
            intro={meta.label === label ? meta.intro : `${meta.label}. ${meta.intro}`}
            toggle={{ checked: i.enabled, onChange: (enabled) => update({ enabled }), label: `${label} enabled` }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              {integrations.length > 1 ? (
                <MoveButtons index={index} count={integrations.length} label={label} onMove={moveIntegration} />
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2 text-xs text-ink-55">
                Monitor page: /admin/monitor/{i.id}
                <RemoveButton label={`Remove ${label}`} onClick={() => removeIntegration(i.id, label)} />
              </div>
            </div>
            {i.enabled && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Name"
                    placeholder={meta.label}
                    value={i.name}
                    maxLength={60}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                  <TextField
                    label={meta.urlLabel}
                    placeholder={meta.placeholder}
                    value={i.url}
                    onChange={(e) => update({ url: e.target.value })}
                  />
                </div>
                {meta.credentials === "userPass" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      label="Username"
                      autoComplete="off"
                      value={i.username}
                      onChange={(e) => update({ username: e.target.value })}
                    />
                    <TextField
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      value={i.password}
                      onChange={(e) => update({ password: e.target.value })}
                    />
                  </div>
                ) : (
                  <TextField
                    label="API key"
                    type="password"
                    autoComplete="off"
                    value={i.apiKey}
                    onChange={(e) => update({ apiKey: e.target.value })}
                    hint={meta.keyHint}
                  />
                )}
                {meta.insecureTls && (
                  <ToggleRow
                    label="Allow self-signed certificate"
                    hint="Skip TLS verification for this HTTPS controller. Leave off unless it uses a self-signed certificate."
                    checked={i.allowInsecureTls}
                    onChange={(allowInsecureTls) => update({ allowInsecureTls })}
                  />
                )}
                {meta.actions && (
                  <ToggleRow
                    label="Allow actions from the dashboard"
                    hint="Off by default — the card stays read-only. When on, admins can act on this service from the Monitor page. Every action is logged."
                    checked={i.allowActions}
                    onChange={(allowActions) => update({ allowActions })}
                  />
                )}
                <IntegrationTest
                  service={i.type}
                  integration={i.id}
                  url={i.url}
                  username={i.username}
                  password={i.password}
                  apiKey={i.apiKey}
                  allowInsecureTls={i.allowInsecureTls}
                />
                {legacy && (
                  <Hint>
                    The {meta.credentials === "apiKey" ? "key" : "password"} can also come from
                    the {legacy} environment variable, which wins over this field.
                  </Hint>
                )}
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
