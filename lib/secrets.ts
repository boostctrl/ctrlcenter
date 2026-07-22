// Secrets that can live in the environment instead of config.yaml: a
// CTRLCENTER_* variable, when set, beats the stored value. One helper so
// every credential field — integration passwords/keys, the CalDAV password,
// the SMTP password — resolves the same way (#212). Resolution happens at use
// time, server-side only; the resolved value never lands in the config file
// or any serialized settings object.
export function resolveSecret(envName: string, stored: string): string {
  return process.env[envName] || stored;
}
