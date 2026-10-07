"use client";

import { Card, Hint, TextField, ToggleRow } from "../ui";
import IntegrationTest from "../IntegrationTest";
import { API_KEY_INTEGRATION_CARDS, USER_PASS_INTEGRATION_CARDS } from "./constants";
import type { SettingsDraft } from "./useSettingsDraft";

export default function IntegrationsSection({ d }: { d: SettingsDraft }) {
  const {
    integrations,
    updateIntegration,
  } = d;
  return (
    <>
      {
        USER_PASS_INTEGRATION_CARDS.map(
          ({ id, title, intro, urlLabel, placeholder, envVar, insecureToggle, actionsToggle }) => (
            <Card
              key={id}
              title={title}
              intro={intro}
              toggle={{
                checked: integrations[id].enabled,
                onChange: (enabled) => updateIntegration(id, { enabled }),
              }}
            >
              {integrations[id].enabled && (
                <>
                  <TextField
                    label={urlLabel}
                    placeholder={placeholder}
                    value={integrations[id].url}
                    onChange={(e) =>
                      updateIntegration(id, { url: e.target.value })
                    }
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      label="Username"
                      autoComplete="off"
                      value={integrations[id].username}
                      onChange={(e) =>
                        updateIntegration(id, { username: e.target.value })
                      }
                    />
                    <TextField
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      value={integrations[id].password}
                      onChange={(e) =>
                        updateIntegration(id, { password: e.target.value })
                      }
                    />
                  </div>
                  {insecureToggle && (
                    <ToggleRow
                      label="Allow self-signed certificate"
                      hint="Skip TLS verification for this HTTPS controller. Leave off unless it uses a self-signed certificate."
                      checked={integrations[id].allowInsecureTls}
                      onChange={(allowInsecureTls) =>
                        updateIntegration(id, { allowInsecureTls })
                      }
                    />
                  )}
                  {actionsToggle && (
                    <ToggleRow
                      label="Allow actions from the dashboard"
                      hint="Off by default — the card stays read-only. When on, admins can act on this service from the Monitor page. Every action is logged."
                      checked={integrations[id].allowActions}
                      onChange={(allowActions) =>
                        updateIntegration(id, { allowActions })
                      }
                    />
                  )}
                  <IntegrationTest
                    service={id}
                    url={integrations[id].url}
                    username={integrations[id].username}
                    password={integrations[id].password}
                    allowInsecureTls={integrations[id].allowInsecureTls}
                  />
                  <Hint>
                    The password can stay out of the config file: set the{" "}
                    {envVar} environment variable instead and leave the field
                    blank.
                  </Hint>
                </>
              )}
            </Card>
          )
        )}

      {
        API_KEY_INTEGRATION_CARDS.map(
          ({ id, title, intro, placeholder, keyHint, envVar, actionsToggle }) => (
            <Card
              key={id}
              title={title}
              intro={intro}
              toggle={{
                checked: integrations[id].enabled,
                onChange: (enabled) => updateIntegration(id, { enabled }),
              }}
            >
              {integrations[id].enabled && (
                <>
                  <TextField
                    label="URL"
                    placeholder={placeholder}
                    value={integrations[id].url}
                    onChange={(e) =>
                      updateIntegration(id, { url: e.target.value })
                    }
                  />
                  <TextField
                    label="API key"
                    type="password"
                    autoComplete="off"
                    value={integrations[id].apiKey}
                    onChange={(e) =>
                      updateIntegration(id, { apiKey: e.target.value })
                    }
                    hint={keyHint}
                  />
                  {actionsToggle && (
                    <ToggleRow
                      label="Allow actions from the dashboard"
                      hint="Off by default — the card stays read-only. When on, admins can act on this service from the Monitor page. Every action is logged."
                      checked={integrations[id].allowActions}
                      onChange={(allowActions) =>
                        updateIntegration(id, { allowActions })
                      }
                    />
                  )}
                  <IntegrationTest
                    service={id}
                    url={integrations[id].url}
                    apiKey={integrations[id].apiKey}
                  />
                  <Hint>
                    The key can stay out of the config file: set the {envVar}{" "}
                    environment variable instead and leave the field blank.
                  </Hint>
                </>
              )}
            </Card>
          )
        )}
    </>
  );
}
