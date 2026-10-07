import { AsyncLocalStorage } from "node:async_hooks";

// Secrets that can live in the environment instead of config.yaml: a
// CTRLCENTER_* variable, when set, beats the stored value. One helper so
// every credential field — integration passwords/keys, the CalDAV password,
// the SMTP password — resolves the same way (#212). Resolution happens at use
// time, server-side only; the resolved value never lands in the config file
// or any serialized settings object.
export function resolveSecret(envName: string, stored: string): string {
  if (envSecretsOff.getStore()) return stored;
  return process.env[envName] || stored;
}

// Env-held secrets belong to the services they were configured for. A "Test
// connection" probe takes its URL from the admin form, so if it ran with them
// it would send e.g. CTRLCENTER_SONARR_KEY to whatever URL was typed in —
// handing out a secret the UI otherwise never reveals. Probes that target
// anything other than the saved URL run inside withoutEnvSecrets, where
// resolveSecret sees only the values the request itself supplied.
const envSecretsOff = new AsyncLocalStorage<true>();

export function withoutEnvSecrets<T>(fn: () => Promise<T>): Promise<T> {
  return envSecretsOff.run(true, fn);
}

// Whether a probe URL is the saved one, ignoring case, surrounding space, and
// trailing slashes — the forms people actually retype a URL in.
export function isSavedUrl(candidate: string, saved: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return saved.trim() !== "" && norm(candidate) === norm(saved);
}
